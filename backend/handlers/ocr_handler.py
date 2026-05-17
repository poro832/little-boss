"""
STEP 2: OCR 핸들러
로컬: PyMuPDF로 텍스트 추출
AWS:  Amazon Textract 사용 (S3 ObjectCreated 이벤트로 트리거)
"""
from utils.storage import get_document, save_document, get_file, put_s3_json
from utils.ocr import extract_text


def handle(event, context=None):
    """Lambda 진입점 — S3 이벤트에서 doc_id 추출 후 처리"""
    record = event['Records'][0]
    s3_key = record['s3']['object']['key']  # uploads/{doc_id}/{filename}
    doc_id = s3_key.split('/')[1]
    return process(doc_id)


def process(doc_id: str) -> dict:
    """
    OCR 처리
    반환: { doc_id, status, text_length }
    """
    doc = get_document(doc_id)
    if not doc:
        return {"success": False, "message": f"문서를 찾을 수 없습니다: {doc_id}"}

    doc["status"] = "ocr_processing"
    save_document(doc_id, doc)

    try:
        file_bytes = get_file(doc["file_path"])
        tmp_path = doc["file_path"]

        raw_text = extract_text(tmp_path, doc["filename"])

        doc["raw_text"] = raw_text
        doc["status"] = "ocr_done"
        save_document(doc_id, doc)

        # ai-analyzer 트리거: S3 ocr-results/ 에 마커 저장
        # (DynamoDB Streams 권한 미부여 우회 — S3 이벤트로 ai-analyzer 실행)
        put_s3_json(f"ocr-results/{doc_id}.json", {"doc_id": doc_id, "status": "ocr_done"})

        return {
            "success": True,
            "doc_id": doc_id,
            "status": "ocr_done",
            "text_length": len(raw_text),
            "preview": raw_text[:200] + "..." if len(raw_text) > 200 else raw_text
        }

    except Exception as e:
        doc["status"] = "error"
        doc["error_message"] = str(e)
        save_document(doc_id, doc)
        return {"success": False, "message": f"OCR 실패: {str(e)}"}

