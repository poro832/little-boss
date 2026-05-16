"""
OCR 레이어 - 로컬(PyMuPDF) / AWS Textract 전환 가능
ENV=local  → PyMuPDF로 PDF 텍스트 추출
ENV=production → Amazon Textract 사용
"""
import os
from pathlib import Path

ENV = os.getenv("ENV", "local")


def extract_text(file_path: str, filename: str) -> str:
    """파일에서 텍스트 추출"""
    ext = Path(filename).suffix.lower()

    if ENV == "local":
        return _extract_local(file_path, ext)

    return _extract_textract(file_path)


def _extract_local(file_path: str, ext: str) -> str:
    """로컬: PyMuPDF(PDF) 또는 Pillow+pytesseract(이미지)"""
    if ext == ".pdf":
        return _extract_pdf(file_path)
    elif ext in [".jpg", ".jpeg", ".png", ".heic"]:
        return _extract_image(file_path)
    else:
        raise ValueError(f"지원하지 않는 파일 형식: {ext}")


def _extract_pdf(file_path: str) -> str:
    try:
        import fitz  # PyMuPDF
        file_bytes = Path(file_path).read_bytes()
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        text = text.strip()
        # 텍스트가 없으면 스캔 PDF → Gemini Vision으로 처리
        if not text:
            return "__IMAGE_FILE__"
        return text
    except ImportError:
        raise ImportError("PyMuPDF 미설치: pip install PyMuPDF")


def _extract_image(file_path: str) -> str:
    # 이미지는 현재 로컬에서 Gemini Vision으로 직접 처리
    # (pytesseract 한국어 지원이 불안정하므로)
    return "__IMAGE_FILE__"  # ai_analyzer에서 이미지 직접 처리


def _extract_textract(s3_key: str) -> str:
    """AWS Textract로 텍스트 추출 (PDF는 다중 페이지 비동기, 이미지는 동기)"""
    import boto3
    import time

    textract = boto3.client('textract', region_name='ap-northeast-2')
    bucket = os.getenv('S3_BUCKET')

    if s3_key.lower().endswith('.pdf'):
        # 다중 페이지 PDF: 비동기 API
        start = textract.start_document_text_detection(
            DocumentLocation={'S3Object': {'Bucket': bucket, 'Name': s3_key}}
        )
        job_id = start['JobId']

        # 완료까지 폴링 (최대 ~50초)
        for _ in range(25):
            time.sleep(2)
            result = textract.get_document_text_detection(JobId=job_id)
            status = result['JobStatus']
            if status == 'SUCCEEDED':
                break
            if status == 'FAILED':
                raise Exception(f"Textract 실패: {result.get('StatusMessage', 'Unknown')}")
        else:
            raise Exception("Textract 타임아웃 (페이지 너무 많음)")

        # 페이지네이션 수집
        lines = []
        next_token = None
        while True:
            kwargs = {'JobId': job_id}
            if next_token:
                kwargs['NextToken'] = next_token
            page = textract.get_document_text_detection(**kwargs)
            lines.extend(b['Text'] for b in page['Blocks'] if b['BlockType'] == 'LINE')
            next_token = page.get('NextToken')
            if not next_token:
                break
        text = '\n'.join(lines)
    else:
        # 이미지 (단일 페이지): 동기 API
        response = textract.detect_document_text(
            Document={'S3Object': {'Bucket': bucket, 'Name': s3_key}}
        )
        lines = [b['Text'] for b in response['Blocks'] if b['BlockType'] == 'LINE']
        text = '\n'.join(lines)

    if not text.strip():
        return "__IMAGE_FILE__"
    return text
