"""테스트용 TXT / DOCX / HWPX 생성 (한글 공지문 샘플)"""
import zipfile

NOTICE = """2026학년도 1학기 교내 근로장학금 신청 안내

학생복지처에서 2026학년도 1학기 교내 근로장학금 신청을 안내드립니다.

1. 신청 기간: 2026년 6월 10일 ~ 2026년 6월 24일 18:00 까지
2. 서류 제출 마감: 2026년 6월 27일 17:00 까지
3. 합격자 발표: 2026년 7월 5일

4. 제출 서류
   - 근로장학금 신청서 1부
   - 재학증명서 1부
   - 통장 사본 1부
   - 시간표 출력본 1부

5. 문의: 학생복지처 (02-9876-5432)

마감일 이후 제출은 받지 않으니 기한을 꼭 지켜주세요.
설명회는 2026년 6월 12일 15:00 학생회관 2층에서 진행됩니다.
"""

# 1) TXT
with open("test.txt", "w", encoding="utf-8") as f:
    f.write(NOTICE)
print("test.txt 생성")

# 2) DOCX
from docx import Document
d = Document()
for line in NOTICE.split("\n"):
    d.add_paragraph(line)
d.save("test.docx")
print("test.docx 생성")

# 3) HWPX (최소 OWPML zip: Contents/section0.xml 에 <hp:t> 텍스트)
paras = "".join(
    f'<hp:p><hp:run charPrIDRef="0"><hp:t>{ln}</hp:t></hp:run></hp:p>'
    for ln in NOTICE.split("\n") if ln.strip()
)
section_xml = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
    'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
    f'{paras}</hs:sec>'
)
mimetype = "application/hwp+zip"
manifest = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'
)
with zipfile.ZipFile("test.hwpx", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("mimetype", mimetype)
    z.writestr("META-INF/manifest.xml", manifest)
    z.writestr("Contents/section0.xml", section_xml)
    z.writestr("Contents/header.xml", '<?xml version="1.0"?><hh:head xmlns:hh="x"/>')
print("test.hwpx 생성")
