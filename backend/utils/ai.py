"""
AI 분석 레이어 - Gemini / Claude(직접) / Bedrock 전환 가능
AI_PROVIDER=gemini   → Google Gemini Flash (로컬 개발용)
AI_PROVIDER=claude   → Anthropic SDK 직접 호출 (ANTHROPIC_API_KEY 필요)
AI_PROVIDER=bedrock  → AWS Bedrock Claude (Lambda 프로덕션 권장, IAM Role 사용)
"""
import os
import json
import re

AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini")

PROMPT_TEMPLATE = """
당신은 한국 행정 서류 분석 전문가입니다.
아래 문서 내용을 분석하여 반드시 JSON 형식으로만 반환하세요.
다른 설명 없이 JSON만 출력하세요.

출력 형식:
{{
  "document_type": "서류 종류 (예: 장학금 공지, 인턴십 모집, 공모전 등)",
  "summary": "문서 핵심 내용 2~3줄 요약",
  "deadlines": [
    {{"date": "YYYY-MM-DD", "description": "마감 내용", "urgency": "high/normal/low"}}
  ],
  "required_documents": [
    {{"name": "서류명", "description": "설명", "have": false}}
  ],
  "calendar_events": [
    {{"title": "일정 제목", "date": "YYYY-MM-DD", "time": "HH:MM", "description": "설명"}}
  ]
}}

분석할 문서:
{text}
"""


def analyze(text: str, image_path: str = None) -> dict:
    """텍스트(또는 이미지)를 AI로 분석하여 구조화된 dict 반환"""
    if AI_PROVIDER == "gemini":
        return _analyze_gemini(text, image_path)
    elif AI_PROVIDER == "claude":
        return _analyze_claude(text)
    elif AI_PROVIDER == "bedrock":
        return _analyze_bedrock(text, image_path)
    else:
        raise ValueError(f"지원하지 않는 AI_PROVIDER: {AI_PROVIDER}")


def _analyze_gemini(text: str, image_path: str = None) -> dict:
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ImportError("google-genai 미설치: pip install google-genai")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다 (.env 파일 확인)")

    client = genai.Client(api_key=api_key)
    model = "gemini-2.0-flash"

    if image_path and text == "__IMAGE_FILE__":
        from utils.storage import get_file

        ext = os.path.splitext(image_path)[1].lower()
        mime_map = {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
            ".heic": "image/heic",
        }
        mime = mime_map.get(ext, "application/pdf")
        file_bytes = get_file(image_path)  # 로컬/S3 공통 (S3 키 대응)
        prompt = PROMPT_TEMPLATE.format(text="[첨부 문서/이미지 참고]")
        response = client.models.generate_content(
            model=model,
            contents=[
                prompt,
                types.Part.from_bytes(data=file_bytes, mime_type=mime)
            ]
        )
    else:
        prompt = PROMPT_TEMPLATE.format(text=text)
        response = client.models.generate_content(model=model, contents=prompt)

    return _parse_response(getattr(response, "text", None))


def _analyze_claude(text: str) -> dict:
    try:
        import anthropic
    except ImportError:
        raise ImportError("anthropic 미설치: pip install anthropic")

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY가 설정되지 않았습니다 (.env 파일 확인)")

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        messages=[{"role": "user", "content": PROMPT_TEMPLATE.format(text=text)}]
    )
    return _parse_response(message.content[0].text)


def _analyze_bedrock(text: str, image_path: str = None) -> dict:
    """AWS Bedrock Claude 호출 (Lambda 프로덕션용, IAM Role 인증)"""
    import boto3

    region = os.getenv("BEDROCK_REGION", "us-east-1")
    model_id = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-haiku-4-5-20251001-v1:0")
    client = boto3.client("bedrock-runtime", region_name=region)

    if text == "__IMAGE_FILE__" and image_path:
        import base64
        from utils.storage import get_file

        ext = os.path.splitext(image_path)[1].lower()
        media_map = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
        }
        # Bedrock Claude는 PDF를 이미지 블록으로 못 받음 (jpeg/png/gif/webp만)
        if ext not in media_map:
            return {
                "document_type": "분석 불가",
                "summary": "이 문서는 텍스트가 추출되지 않는 스캔본/PDF입니다. 이미지(JPG/PNG)로 업로드하거나 텍스트가 포함된 PDF를 사용해주세요.",
                "deadlines": [],
                "required_documents": [],
                "calendar_events": [],
            }
        file_bytes = get_file(image_path)  # 로컬/S3 공통 (S3 키 대응)
        img_b64 = base64.b64encode(file_bytes).decode()
        content = [
            {"type": "image", "source": {"type": "base64", "media_type": media_map[ext], "data": img_b64}},
            {"type": "text", "text": PROMPT_TEMPLATE.format(text="[첨부 이미지 참고]")}
        ]
    else:
        content = PROMPT_TEMPLATE.format(text=text)

    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": content}]
    })
    response = client.invoke_model(modelId=model_id, body=body)
    result = json.loads(response["body"].read())
    try:
        raw = result["content"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raw = None
    return _parse_response(raw)


def _parse_response(raw) -> dict:
    """AI 응답에서 JSON 추출 (None/비정상 응답 방어)"""
    fallback = {
        "document_type": "알 수 없음",
        "summary": "분석 실패 - 다시 시도해주세요",
        "deadlines": [],
        "required_documents": [],
        "calendar_events": []
    }
    if not raw or not isinstance(raw, str):
        return fallback

    # 1차: 마크다운 코드블록 제거 후 파싱
    cleaned = re.sub(r"```json\s*|\s*```", "", raw).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 2차: 본문에서 첫 { ~ 마지막 } 사이 JSON 객체만 추출
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError:
            pass

    return fallback
