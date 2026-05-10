"""
로컬 테스트 서버 (Flask)
AWS 없이 백엔드 전체 흐름 테스트 가능

실행: python local_server.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS

from handlers.upload_handler import process as upload_handle
from handlers.ocr_handler import process as ocr_handle
from handlers.ai_handler import process as ai_handle
from handlers.action_handler import (
    handle_calendar,
    handle_checklist,
    handle_checklist_update
)
from utils.storage import get_document, list_documents

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB
CORS(app, resources={r"/*": {"origins": "*"}})

@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    tb = traceback.format_exc()
    print(f"\n[ERROR] {e}\n{tb}")
    return jsonify({"success": False, "message": str(e), "traceback": tb}), 500


# ── 업로드 ─────────────────────────────────────────────────

@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"success": False, "message": "파일이 없습니다."}), 400

    file = request.files["file"]
    result = upload_handle(
        filename=file.filename,
        file_bytes=file.read(),
        user_id=request.form.get("user_id", "local_user")
    )
    return jsonify(result)


# ── OCR ────────────────────────────────────────────────────

@app.route("/ocr/<doc_id>", methods=["POST"])
def ocr(doc_id):
    result = ocr_handle(doc_id)
    return jsonify(result)


# ── AI 분석 ────────────────────────────────────────────────

@app.route("/analyze/<doc_id>", methods=["POST"])
def analyze(doc_id):
    result = ai_handle(doc_id)
    return jsonify(result)


# ── 전체 파이프라인 (업로드 → OCR → AI 한 번에) ───────────

@app.route("/process", methods=["POST"])
def process():
    """파일 업로드부터 AI 분석까지 한 번에 처리"""
    if "file" not in request.files:
        return jsonify({"success": False, "message": "파일이 없습니다."}), 400

    file = request.files["file"]

    # 1. 업로드
    upload_result = upload_handle(file.filename, file.read())
    if not upload_result["success"]:
        return jsonify(upload_result), 400
    doc_id = upload_result["doc_id"]

    # 2. OCR
    ocr_result = ocr_handle(doc_id)
    if not ocr_result["success"]:
        # 텍스트 추출 실패해도 AI가 직접 처리 시도
        app.logger.warning(f"OCR 실패: {ocr_result['message']}, AI 직접 분석 시도")

    # 3. AI 분석
    ai_result = ai_handle(doc_id)
    if not ai_result["success"]:
        ai_result["doc_id"] = doc_id
        return jsonify(ai_result)

    return jsonify({
        "success": True,
        "doc_id": doc_id,
        "analysis": ai_result["analysis"]
    })


# ── 문서 조회 ──────────────────────────────────────────────

@app.route("/documents", methods=["GET"])
def documents():
    user_id = request.args.get("user_id", "local_user")
    docs = list_documents(user_id)
    return jsonify({"success": True, "documents": docs})


@app.route("/documents/<doc_id>", methods=["GET"])
def document(doc_id):
    doc = get_document(doc_id)
    if not doc:
        return jsonify({"success": False, "message": "문서를 찾을 수 없습니다."}), 404
    return jsonify({"success": True, "document": doc})


# ── 캘린더 ─────────────────────────────────────────────────

@app.route("/calendar/<doc_id>", methods=["POST"])
def calendar(doc_id):
    result = handle_calendar(doc_id)
    return jsonify(result)


# ── 체크리스트 ─────────────────────────────────────────────

@app.route("/checklist/<doc_id>", methods=["GET"])
def checklist(doc_id):
    result = handle_checklist(doc_id)
    return jsonify(result)


@app.route("/checklist/<doc_id>", methods=["PATCH"])
def checklist_update(doc_id):
    body = request.get_json()
    result = handle_checklist_update(
        doc_id,
        item_name=body.get("name"),
        completed=body.get("completed", False)
    )
    return jsonify(result)


# ── 헬스체크 ───────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "env": os.getenv("ENV", "local"),
        "ai_provider": os.getenv("AI_PROVIDER", "gemini")
    })


if __name__ == "__main__":
    print("=" * 50)
    print("  LittleBoss 로컬 서버 시작")
    print("  http://localhost:5000")
    print("=" * 50)
    app.run(debug=False, port=5000, threaded=True)
