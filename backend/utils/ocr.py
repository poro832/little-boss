"""
문서 텍스트 추출 레이어 - 다양한 형식 지원
- PDF / 이미지(JPG·PNG·HEIC·GIF·WEBP·TIFF) : Textract(프로덕션) / PyMuPDF(로컬)
- DOCX : python-docx 직접 추출 (OCR 불필요)
- TXT  : 직접 디코딩
- HWPX : zip+XML 파싱 (한글 신형식, stdlib만 사용)
- HWP/DOC(구 바이너리) : 변환 안내 메시지
ENV=local → 로컬 처리 / ENV=production → AWS 처리
"""
import os
import io
import re
import zipfile
from pathlib import Path

ENV = os.getenv("ENV", "local")

PDF_EXT = {".pdf"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".tif"}
TEXT_DIRECT_EXT = {".txt", ".md", ".csv"}


def extract_text(file_path: str, filename: str) -> str:
    """파일에서 텍스트 추출 (형식별 라우팅)"""
    ext = Path(filename).suffix.lower()

    # 1) 텍스트 직접 추출 형식 (OCR 불필요, 로컬·프로덕션 공통)
    if ext == ".docx":
        return _extract_docx(file_path)
    if ext == ".hwpx":
        return _extract_hwpx(file_path)
    if ext in TEXT_DIRECT_EXT:
        return _extract_txt(file_path)
    if ext in {".hwp", ".doc"}:
        # 구 바이너리 포맷: 안정적 파싱 불가 → 안내
        return "__UNSUPPORTED__"

    # 2) PDF / 이미지
    if ENV == "local":
        if ext in PDF_EXT:
            return _extract_pdf_local(file_path)
        if ext in IMAGE_EXT:
            return "__IMAGE_FILE__"  # 로컬: AI Vision 처리
        return "__UNSUPPORTED__"

    # 프로덕션
    if ext in PDF_EXT or ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
        return _extract_textract(file_path)
    if ext in IMAGE_EXT:
        return "__IMAGE_FILE__"  # Textract 미지원 이미지 → AI Vision
    return "__UNSUPPORTED__"


def _read_bytes(file_path: str) -> bytes:
    """로컬 경로 / S3 키 공통 바이트 읽기"""
    from utils.storage import get_file
    return get_file(file_path)


# ── 텍스트 직접 추출 ──────────────────────────────────────

def _extract_docx(file_path: str) -> str:
    try:
        from docx import Document as Docx
    except ImportError:
        raise ImportError("python-docx 미설치: pip install python-docx")
    data = _read_bytes(file_path)
    doc = Docx(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    # 표 안의 텍스트도 수집
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    text = "\n".join(parts).strip()
    return text or "__IMAGE_FILE__"


def _extract_hwpx(file_path: str) -> str:
    """HWPX(한글 신형식) = OPC zip 컨테이너. Contents 내 섹션 XML에서 텍스트 추출"""
    data = _read_bytes(file_path)
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return "__UNSUPPORTED__"

    chunks = []
    with zf:
        # sectionN.xml 우선, 없으면 Contents/ 내 모든 xml
        names = [n for n in zf.namelist() if re.search(r"section\d+\.xml$", n, re.I)]
        if not names:
            names = [n for n in zf.namelist()
                     if n.lower().startswith("contents/") and n.lower().endswith(".xml")]
        for n in sorted(names):
            try:
                xml = zf.read(n).decode("utf-8", errors="ignore")
            except Exception:
                continue
            # <hp:t ...> 또는 <t ...> (속성 유무 모두), 중첩 태그 제거
            texts = re.findall(r"<(?:\w+:)?t\b[^>]*>(.*?)</(?:\w+:)?t>", xml, re.DOTALL)
            if texts:
                chunks.append(" ".join(re.sub(r"<[^>]+>", "", t) for t in texts))
            else:
                chunks.append(re.sub(r"<[^>]+>", " ", xml))

    text = re.sub(r"\s+", " ", " ".join(chunks)).strip()
    return text or "__IMAGE_FILE__"


def _extract_txt(file_path: str) -> str:
    data = _read_bytes(file_path)
    for enc in ("utf-8", "cp949", "euc-kr"):
        try:
            return data.decode(enc).strip() or "__IMAGE_FILE__"
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore").strip() or "__IMAGE_FILE__"


# ── PDF / 이미지 ─────────────────────────────────────────

def _extract_pdf_local(file_path: str) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise ImportError("PyMuPDF 미설치: pip install PyMuPDF")
    file_bytes = Path(file_path).read_bytes()
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    text = "".join(page.get_text() for page in doc).strip()
    return text or "__IMAGE_FILE__"  # 텍스트 없으면 스캔 PDF → AI Vision


def _extract_textract(s3_key: str) -> str:
    """AWS Textract로 텍스트 추출 (PDF는 다중 페이지 비동기, 이미지는 동기)"""
    import boto3
    import time

    textract = boto3.client('textract', region_name='ap-northeast-2')
    bucket = os.getenv('S3_BUCKET')

    if s3_key.lower().endswith('.pdf'):
        start = textract.start_document_text_detection(
            DocumentLocation={'S3Object': {'Bucket': bucket, 'Name': s3_key}}
        )
        job_id = start['JobId']
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
        response = textract.detect_document_text(
            Document={'S3Object': {'Bucket': bucket, 'Name': s3_key}}
        )
        lines = [b['Text'] for b in response['Blocks'] if b['BlockType'] == 'LINE']
        text = '\n'.join(lines)

    if not text.strip():
        return "__IMAGE_FILE__"
    return text
