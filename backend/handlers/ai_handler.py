"""
STEP 3: AI 분석 핸들러
추출된 텍스트를 AI로 분석하여 마감일, 준비물, 일정 추출
AWS: DynamoDB Streams 이벤트로 트리거 (status == ocr_done)
     S3 이벤트도 방어적으로 호환 처리 (트리거 방식 변경 대비)
"""
from utils.storage import get_document, save_document
from utils.ai import analyze


def handle(event, context=None):
    """Lambda 진입점 — S3 이벤트 또는 DynamoDB Streams 이벤트에서 doc_id 추출"""
    for record in event.get('Records', []):
        doc_id = None

        # 1) S3 이벤트 (ocr-results/{doc_id}.json) — 주 트리거
        if record.get('eventSource') == 'aws:s3' or 's3' in record:
            key = record['s3']['object']['key']  # ocr-results/{doc_id}.json
            doc_id = key.split('/')[-1].rsplit('.', 1)[0]

        # 2) DynamoDB Streams 이벤트 — 권한 부여 시 호환
        elif record.get('eventName') == 'MODIFY':
            new_image = record.get('dynamodb', {}).get('NewImage', {})
            status = new_image.get('status', {}).get('S', '')
            if status == 'ocr_done':
                doc_id = new_image.get('doc_id', {}).get('S', '')

        if doc_id:
            process(doc_id)
    return {'success': True}


def process(doc_id: str) -> dict:
    """
    AI 분석 처리
    반환: { doc_id, status, analysis }
    """
    doc = get_document(doc_id)
    if not doc:
        return {"success": False, "message": f"문서를 찾을 수 없습니다: {doc_id}"}

    if doc["status"] not in ["ocr_done"]:
        return {"success": False, "message": f"OCR이 완료되지 않았습니다. 현재 상태: {doc['status']}"}

    doc["status"] = "ai_processing"
    save_document(doc_id, doc)

    try:
        raw_text = doc.get("raw_text", "")
        image_path = doc["file_path"] if raw_text == "__IMAGE_FILE__" else None

        result = analyze(raw_text, image_path)

        doc["analysis"] = result
        doc["status"] = "done"
        save_document(doc_id, doc)

        return {
            "success": True,
            "doc_id": doc_id,
            "status": "done",
            "analysis": result
        }

    except Exception as e:
        doc["status"] = "error"
        doc["error_message"] = str(e)
        save_document(doc_id, doc)
        return {"success": False, "message": f"AI 분석 실패: {str(e)}"}
