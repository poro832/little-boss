"""테스트용 한글 텍스트 PDF 생성 (장학금 공지문 샘플)"""
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium"))

c = canvas.Canvas("test_text.pdf", pagesize=A4)
w, h = A4
y = h - 60

lines = [
    ("2026학년도 1학기 국가장학금 신청 안내", 16),
    ("", 6),
    ("한국장학재단에서 2026학년도 1학기 국가장학금 신청을 아래와 같이 안내드립니다.", 11),
    ("재학생 및 신입생은 기한 내 반드시 신청을 완료하시기 바랍니다.", 11),
    ("", 8),
    ("1. 신청 기간: 2026년 6월 2일 ~ 2026년 6월 20일 18:00 까지", 12),
    ("2. 서류 제출 마감: 2026년 6월 25일 17:00 까지", 12),
    ("3. 최종 결과 발표: 2026년 7월 10일", 12),
    ("", 8),
    ("4. 제출 서류", 13),
    ("   - 국가장학금 신청서 (포털에서 작성)", 11),
    ("   - 가족관계증명서 1부", 11),
    ("   - 주민등록등본 1부", 11),
    ("   - 소득분위 확인 동의서", 11),
    ("   - 재학증명서 1부", 11),
    ("", 8),
    ("5. 유의 사항", 13),
    ("   - 마감일 이후 제출분은 일절 받지 않습니다.", 11),
    ("   - 서류 미비 시 장학금 지급이 취소될 수 있습니다.", 11),
    ("   - 문의: 학생지원팀 (02-1234-5678)", 11),
    ("", 8),
    ("본 신청 마감은 2026-06-20 이며, 서류 마감은 2026-06-25 입니다.", 11),
    ("장학 설명회는 2026년 6월 5일 14:00 대강당에서 진행됩니다.", 11),
]

for text, size in lines:
    c.setFont("HYSMyeongJo-Medium", size)
    c.drawString(50, y, text)
    y -= size + 10

c.showPage()
c.save()
print("test_text.pdf 생성 완료")
