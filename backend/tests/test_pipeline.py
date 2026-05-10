"""
전체 파이프라인 테스트 (API 키 없이 구조 테스트)
실행: python tests/test_pipeline.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv()

from handlers.upload_handler import handle as upload_handle
from handlers.ocr_handler import handle as ocr_handle
from handlers.ai_handler import handle as ai_handle
from handlers.action_handler import handle_checklist, handle_calendar


def test_upload():
    print("\n[1] 업로드 테스트")
    dummy_pdf = b"%PDF-1.4 test content"
    result = upload_handle("test.pdf", dummy_pdf)
    print(f"  결과: {result}")
    assert result["success"], "업로드 실패"
    return result["doc_id"]


def test_ocr(doc_id):
    print("\n[2] OCR 테스트")
    result = ocr_handle(doc_id)
    print(f"  결과: {result}")
    return result


def test_full_pipeline():
    print("=" * 50)
    print("  LittleBoss 파이프라인 테스트")
    print("=" * 50)

    doc_id = test_upload()
    test_ocr(doc_id)

    print("\n[OK] 기본 구조 테스트 완료")
    print(f"  doc_id: {doc_id}")
    print("\n  AI 분석 테스트는 .env에 API 키 설정 후 가능합니다.")
    print("  1. .env.example → .env 복사")
    print("  2. GEMINI_API_KEY 입력")
    print("  3. python local_server.py 실행")


if __name__ == "__main__":
    test_full_pipeline()
