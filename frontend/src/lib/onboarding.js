// 첫 실행 안내의 표시 여부만 관리한다. 화면은 components/Onboarding.jsx 가 그린다.

const KEY = 'onboarded';

// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 플래그를 남길 수 없어
// 매번 안내가 떠 앱을 쓸 수 없게 된다. 그때는 이 메모리 플래그로 버틴다.
let shownThisSession = false;

/** 처음 열었는지. 읽기가 막혀 있으면 안내를 건너뛴다(막는 것보다 낫다). */
export function shouldShowOnboarding() {
  if (shownThisSession) return false;
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return false;
  }
}

export function markOnboarded() {
  shownThisSession = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // 저장은 실패해도 이번 세션에는 다시 뜨지 않는다.
  }
}

/** 내 정보에서 '앱 사용법 다시 보기'를 눌렀을 때. */
export function resetOnboarding() {
  shownThisSession = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 지우지 못해도 메모리 플래그가 풀려 이번에는 다시 보인다.
  }
}

// icon은 아이콘 이름만 담는다. 이 파일이 React에 의존하지 않게 하기 위해서다.
export const ONBOARD_STEPS = [
  {
    icon: 'Upload',
    title: '문서를 올리세요',
    desc: '장학금 신청서, 기숙사 공고처럼 마감이 있는 행정 서류를 올리면 됩니다.\nPDF · 한글 · 워드 · 사진 모두 됩니다.',
  },
  {
    icon: 'Sparkle',
    title: 'AI가 마감일과 준비물을 정리합니다',
    desc: '문서를 읽어 언제까지 무엇을 내야 하는지 뽑아냅니다.\n준비물은 체크리스트로 만들어 드려요.',
  },
  {
    icon: 'Bell',
    title: '마감 전에 알려드립니다',
    desc: '7일·3일·1일 전에 알림이 갑니다.\n내 정보 > 알림 설정에서 켜고 끌 수 있어요.',
  },
];
