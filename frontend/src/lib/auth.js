// localStorage 직접 접근을 이 파일로 모은다.
// 화면 코드는 키 이름을 알 필요가 없다.
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 차단 환경 */ } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* 차단 환경 */ } };

export function getUser() {
  return {
    id: read('user_id') || '',
    name: read('user_name') || '사용자',
    email: read('user_email') || '',
    affiliation: read('user_affiliation') || '',
  };
}

export function isLoggedIn() {
  return !!read('user_id');
}

// 이메일 가입자는 user_id가 이메일(@ 포함), 구글 로그인은 숫자 sub
export function isEmailUser() {
  return (read('user_id') || '').includes('@');
}

export function saveSession({ user_id, email, name }) {
  write('user_id', user_id);
  write('user_email', email || '');
  write('user_name', name || '');
}

// 프로필 저장 성공 후 로컬 캐시 갱신 (키 이름은 이 파일 밖으로 노출하지 않는다)
export function updateLocalProfile({ name, affiliation } = {}) {
  if (name !== undefined) write('user_name', name);
  if (affiliation !== undefined) write('user_affiliation', affiliation);
}

export function clearSession() {
  ['user_id', 'user_email', 'user_name', 'user_affiliation', 'user_token',
   'dismissed_notifs', 'profileImage'].forEach(drop);
}

// ── Google 캘린더 토큰 (1시간 만료) ──
// 만료돼도 로그인 세션은 건드리지 않는다. 캘린더 연결만 끊는다.
export function getCalendarToken() { return read('user_token'); }
export function saveCalendarToken(t) { write('user_token', t); }
export function clearCalendarToken() { drop('user_token'); }
