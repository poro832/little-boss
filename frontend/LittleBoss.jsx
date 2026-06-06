import { useState, useEffect, useRef } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import logo from "./logo.svg";
import { uploadFile, pollUntilDone, registerCalendar, useDocuments, ddayInfo, updateChecklistItem, deadlinesForMonth, signup as apiSignup, emailLogin as apiEmailLogin, deleteDocument, updateProfile, changePassword, updateNotifSettings, deleteAccount, requestReset, verifyReset, confirmReset } from "./api";


// ── Color tokens ──
const C = {
  purple: "#6B4FE8",
  purpleDark: "#5038C4",
  purpleLight: "#8B72F0",
  purpleBg: "#F0ECFF",
  purpleBorder: "rgba(107,79,232,0.15)",
  bg: "#F2F1F6",
  white: "#FFFFFF",
  text: "#1A1025",
  textMid: "#5A4D7A",
  textLight: "#9B90B8",
  red: "#E53E3E",
  redBg: "#FFF0F0",
  green: "#22C55E",
  greenBg: "#F0FFF4",
  ongoing: "#EA580C",
  ongoingBg: "#FFF7ED",
  border: "#E8E4F4",
  track: "#EDE9FF",
  todayText: "#0066CC",
  todayBg: "#E0F2FE",
};

// ── 문서 상태 → 라벨·색 (전 화면 공통) ──
const STATUS = {
  "진행 중": { color: C.ongoing, bg: C.ongoingBg },
  "완료": { color: C.green, bg: C.greenBg },
  "미완료": { color: C.red, bg: C.redBg },
};
// 시간대별 인사말
const greeting = () => {
  const h = new Date().getHours();
  if (h < 6) return "늦은 시간이네요";
  if (h < 12) return "좋은 아침입니다";
  if (h < 18) return "좋은 오후입니다";
  return "좋은 저녁입니다";
};

// ── Shared styles ──
const S = {
  card: { background: C.white, borderRadius: 14, padding: 22, boxShadow: "0 1px 8px rgba(107,79,232,0.07)" },
  btnPrimary: { background: C.purple, color: "white", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" },
  btnOutline: { background: "white", color: C.textMid, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7 },
  formInput: { width: "100%", padding: "12px 14px", border: "1.5px solid " + C.border, borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", background: C.white, color: C.text, boxSizing: "border-box" },
  label: { fontSize: 13, fontWeight: 600, color: C.textMid, display: "block", marginBottom: 6 },
};

// ── 빈 상태 (아이콘 + 안내 + 선택적 CTA) ──
function EmptyState({ icon = "📭", title, desc, actionLabel, onAction }) {
  return (
    <div style={{ ...S.card, textAlign: "center", padding: "44px 24px" }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.85 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>{title}</div>
      {desc && <div style={{ fontSize: 13, color: C.textLight, lineHeight: 1.6, marginBottom: actionLabel ? 18 : 0 }}>{desc}</div>}
      {actionLabel && <button onClick={onAction} style={{ ...S.btnPrimary, justifyContent: "center" }}>{actionLabel}</button>}
    </div>
  );
}

// ── 로딩 스켈레톤 (lbpulse 키프레임은 App 루트에서 주입) ──
function Skeleton({ rows = 3 }) {
  const bar = (w) => ({ height: 11, width: w, borderRadius: 6, background: C.bg, animation: "lbpulse 1.2s ease-in-out infinite" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ ...S.card, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...bar("45%"), height: 14 }} />
          <div style={bar("78%")} />
          <div style={bar("60%")} />
        </div>
      ))}
    </div>
  );
}

// ── 반응형: 모바일 여부 (기본 분기점 768px) ──
function useIsMobile(bp = 768) {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const onResize = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);
  return m;
}

// ── Password validation ──
const validatePassword = (password) => {
  const hasEnglish = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+=\-\[\]{};':"\\|,.<>\/?]/.test(password);
  const isLongEnough = password.length >= 8;
  return hasEnglish && hasNumber && hasSpecial && isLongEnough;
};

const getPasswordErrorMessage = (password) => {
  if (!password) return "비밀번호를 입력해주세요";
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다";
  if (!/[a-zA-Z]/.test(password)) return "영문을 포함해주세요";
  if (!/\d/.test(password)) return "숫자를 포함해주세요";
  if (!/[!@#$%^&*()_+=\-\[\]{};':"\\|,.<>\/?]/.test(password)) return "특수기호를 포함해주세요";
  return null;
};

// ── Email validation ──
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ── 현재 로그인 사용자 (Google/이메일 공통) ──
const getUser = () => ({
  name: localStorage.getItem("user_name") || "사용자",
  email: localStorage.getItem("user_email") || "",
});

// ── Toast ──
function useToast() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef(null);
  const toast = (m) => {
    setMsg(m); setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2800);
  };
  return { msg, show, toast };
}

// ── Google icon ──
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// ── 브랜드 패널용 라인 아이콘 (흰색 stroke) ──
const IconWrap = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const DocIcon = () => (
  <IconWrap><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></IconWrap>
);
const CheckIcon = () => (
  <IconWrap><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></IconWrap>
);
const CalIcon = () => (
  <IconWrap><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></IconWrap>
);

// 하단 추상 흐름 일러스트: 문서 → AI → 캘린더
const FlowIllustration = () => (
  <svg width="100%" height="92" viewBox="0 0 360 92" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.6">
    <rect x="14" y="20" width="52" height="64" rx="6" />
    <path d="M26 38h28M26 50h28M26 62h18" strokeWidth="1.4" />
    <path d="M78 52h36" strokeDasharray="2 5" />
    <circle cx="148" cy="52" r="26" stroke="rgba(255,255,255,0.7)" />
    <path d="M148 40l3.2 7.6 7.8.6-6 5 1.9 7.6-6.9-4.2-6.9 4.2 1.9-7.6-6-5 7.8-.6z" fill="rgba(255,255,255,0.85)" stroke="none" />
    <path d="M182 52h36" strokeDasharray="2 5" />
    <rect x="232" y="22" width="62" height="60" rx="6" stroke="rgba(255,255,255,0.7)" />
    <path d="M232 38h62M248 22v8M278 22v8" strokeWidth="1.4" />
    <rect x="246" y="50" width="12" height="12" rx="2" fill="rgba(255,255,255,0.85)" stroke="none" />
    <path d="M308 52h34" strokeDasharray="2 5" />
    <path d="M338 44l8 8-8 8" />
  </svg>
);

// ── Auth pages ──
function AuthLayout({ children }) {
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth <= 900);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const brandHeader = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
      <img src={logo} alt="LittleBoss" style={{ width: 50, height: 50, borderRadius: 10 }} />
      <span style={{ fontWeight: 700, fontSize: 18, color: C.text }}>LittleBoss</span>
    </div>
  );

  // 좁은 화면(≤900px): 기존 단일 카드 폴백
  if (narrow) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: C.white, borderRadius: 20, padding: "48px 44px", width: "100%", maxWidth: 420, boxShadow: "0 8px 48px rgba(107,79,232,0.12)" }}>
          {brandHeader}
          {children}
        </div>
      </div>
    );
  }

  const Feature = ({ icon, title, desc }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "white", marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      {/* 좌: 브랜드 패널 */}
      <div style={{ flex: "1 1 60%", background: `linear-gradient(150deg, ${C.purpleLight} 0%, ${C.purple} 45%, ${C.purpleDark} 100%)`, padding: "60px 56px", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -90, right: -90, width: 300, height: 300, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
        <div style={{ position: "absolute", bottom: -130, left: -70, width: 340, height: 340, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />

        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 52 }}>
            <img src={logo} alt="LittleBoss" style={{ width: 44, height: 44, borderRadius: 10 }} />
            <span style={{ fontWeight: 800, fontSize: 20, color: "white" }}>LittleBoss</span>
          </div>
          <h1 style={{ fontSize: 31, fontWeight: 800, color: "white", lineHeight: 1.38, margin: "0 0 16px" }}>
            행정 서류,<br />AI가 대신 정리해드려요
          </h1>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.8)", lineHeight: 1.6, margin: "0 0 44px" }}>
            공지문만 올리면 마감일 · 준비서류 · 일정을<br />자동으로 추출해 캘린더에 등록합니다.
          </p>
          <Feature icon={<DocIcon />} title="마감일 자동 추출" desc="문서 속 마감일을 놓치지 않게 자동 정리" />
          <Feature icon={<CheckIcon />} title="준비서류 체크리스트" desc="필요한 서류를 한눈에, 진행률까지" />
          <Feature icon={<CalIcon />} title="캘린더 자동 등록" desc="마감 D-7 · D-3 · D-1 리마인더까지 자동" />
        </div>

        <div style={{ position: "relative", marginTop: 36 }}>
          <FlowIllustration />
        </div>
      </div>

      {/* 우: 로그인/회원가입 카드 */}
      <div style={{ flex: "1 1 40%", background: C.white, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 32px" }}>
        <div style={{ width: "100%", maxWidth: 400 }}>
          {brandHeader}
          {children}
        </div>
      </div>
    </div>
  );
}

function GoogleBtn({ label, onLogin, onClick, toast }) {
  const login = useGoogleLogin({
    scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse.access_token;
      try {
        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const user = await res.json();
        localStorage.setItem("user_id", user.sub);
        localStorage.setItem("user_email", user.email || "");
        localStorage.setItem("user_name", user.name || "");
        localStorage.setItem("user_token", accessToken);
        onLogin?.(`${user.name || "사용자"}님 환영합니다 👋`);
      } catch (e) {
        onLogin?.("로그인됐어요 (사용자 정보 조회 실패)");
      }
    },
    onError: () => (toast ? toast("Google 로그인 실패. 다시 시도해주세요.") : null),
  });

  const handleClick = onLogin ? () => login() : onClick;
  return (
    <button onClick={handleClick} style={{ width: "100%", padding: 13, borderRadius: 10, fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", background: "white", border: "1.5px solid " + C.border, color: C.text, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 }}>
      <GoogleIcon /> {label}
    </button>
  );
}

function ConnectGoogleCalendar({ toast, label = "Google 캘린더 연결하기" }) {
  const connect = useGoogleLogin({
    scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
    onSuccess: (tokenResponse) => {
      // 신원(user_id/email/name)은 건드리지 않고 캘린더 쓰기용 access token만 저장
      localStorage.setItem("user_token", tokenResponse.access_token);
      toast?.("Google 캘린더가 연결됐어요 📅");
      setTimeout(() => window.location.reload(), 600);
    },
    onError: () => toast?.("Google 캘린더 연결 실패. 다시 시도해주세요."),
  });
  return (
    <button onClick={() => connect()} style={{ width: "100%", padding: 13, borderRadius: 10, fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", background: "white", border: "1.5px solid " + C.border, color: C.text, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <GoogleIcon /> {label}
    </button>
  );
}

function DividerOr() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.textLight, fontSize: 13, margin: "18px 0" }}>
      <div style={{ flex: 1, height: 1, background: C.border }} /> 또는 이메일로 <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function SignupPage({ onLogin, goLogin, toast }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const handleSignup = async () => {
    if (!name) { toast("이름을 입력해주세요"); return; }
    if (!email) { toast("이메일을 입력해주세요"); return; }
    if (!validateEmail(email)) { toast("이메일 형식이 올바르지 않습니다"); return; }
    const passwordError = getPasswordErrorMessage(password);
    if (passwordError) { toast(passwordError); return; }
    if (!confirmPassword) { toast("비밀번호 확인을 입력해주세요"); return; }
    if (password !== confirmPassword) { toast("비밀번호가 일치하지 않습니다"); return; }
    if (!agreeTerms) { toast("약관에 동의해주세요"); return; }

    setSubmitting(true);
    try {
      const { data } = await apiSignup(name, email, password);
      if (!data.success) { toast(data.message || "회원가입에 실패했어요"); return; }
      localStorage.setItem("user_id", data.user_id);
      localStorage.setItem("user_email", data.email);
      localStorage.setItem("user_name", data.name);
      onLogin("🎉 회원가입이 완료됐어요!");
    } catch (e) {
      toast(e.response?.data?.message || "회원가입 중 오류가 발생했어요");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>회원가입</h2>
      <p style={{ fontSize: 14, color: C.textLight, marginBottom: 28 }}>계정을 만들고 AI 행정 비서를 시작하세요</p>
      <GoogleBtn label="Google로 계속하기" onLogin={onLogin} toast={toast} />
      <DividerOr />
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>이름</label>
        <input style={S.formInput} type="text" placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>이메일</label>
        <input style={S.formInput} type="email" placeholder="example@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        {email && !validateEmail(email) && <p style={{ fontSize: 11, color: C.red, marginTop: 5 }}>⚠ 이메일 형식이 올바르지 않습니다</p>}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>비밀번호</label>
        <input style={S.formInput} type="password" placeholder="8자 이상 입력" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p style={{ fontSize: 11, color: password && !validatePassword(password) ? C.red : C.textLight, marginTop: 5 }}>
          {password && !validatePassword(password) ? "⚠ 영문, 숫자, 특수문자를 모두 포함해야 합니다" : "영문, 숫자, 특수문자 포함 8자 이상"}
        </p>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>비밀번호 확인</label>
        <input style={S.formInput} type="password" placeholder="비밀번호 재입력" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: C.textMid, marginBottom: 24 }}>
        <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} style={{ marginTop: 2, accentColor: C.purple }} />
        <label><span style={{ color: C.purple, cursor: "pointer" }}>이용약관</span> 및 <span style={{ color: C.purple, cursor: "pointer" }}>개인정보 처리방침</span>에 동의합니다.</label>
      </div>
      <button style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", padding: 13, fontSize: 15, opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={handleSignup}>{submitting ? "처리 중..." : "가입하기"}</button>
      <div style={{ textAlign: "center", fontSize: 13, color: C.textLight, marginTop: 20 }}>
        이미 계정이 있으신가요? <span style={{ color: C.purple, fontWeight: 600, cursor: "pointer" }} onClick={goLogin}>로그인</span>
      </div>
    </AuthLayout>
  );
}

function LoginPage({ onLogin, goSignup, goForgotPassword, toast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    if (!email) { toast("이메일을 입력해주세요"); return; }
    if (!validateEmail(email)) { toast("이메일 형식이 올바르지 않습니다"); return; }
    if (!password) { toast("비밀번호를 입력해주세요"); return; }

    setSubmitting(true);
    try {
      const { data } = await apiEmailLogin(email, password);
      if (!data.success) { toast(data.message || "로그인에 실패했어요"); return; }
      localStorage.setItem("user_id", data.user_id);
      localStorage.setItem("user_email", data.email);
      localStorage.setItem("user_name", data.name);
      onLogin("로그인됐어요 👋");
    } catch (e) {
      toast(e.response?.data?.message || "로그인 중 오류가 발생했어요");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>로그인</h2>
      <p style={{ fontSize: 14, color: C.textLight, marginBottom: 28 }}>계정에 로그인해 주세요</p>
      <GoogleBtn label="Google 로그인" onLogin={onLogin} toast={toast} />
      <DividerOr />
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>이메일</label>
        <input style={S.formInput} type="email" placeholder="example@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>비밀번호</label>
        <input style={S.formInput} type="password" placeholder="비밀번호 입력" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", padding: 13, fontSize: 15, marginBottom: 12, opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={handleLogin}>{submitting ? "로그인 중..." : "로그인"}</button>
      <div style={{ textAlign: "center", fontSize: 12, color: C.textLight, marginBottom: 4 }}>
        <span style={{ color: C.purple, cursor: "pointer" }} onClick={goForgotPassword}>비밀번호를 잊으셨나요?</span>
      </div>
      <div style={{ textAlign: "center", fontSize: 13, color: C.textLight, marginTop: 16 }}>
        계정이 없으신가요? <span style={{ color: C.purple, fontWeight: 600, cursor: "pointer" }} onClick={goSignup}>회원가입</span>
      </div>
    </AuthLayout>
  );
}

function ForgotPasswordPage({ toast, goLogin }) {
  const [step, setStep] = useState(1); // 1: email, 2: code, 3: password reset
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [busy, setBusy] = useState(false);

  const handleEmailSubmit = async () => {
    if (!email) { toast("이메일을 입력해주세요"); return; }
    if (!validateEmail(email)) { toast("이메일 형식이 올바르지 않습니다"); return; }
    setBusy(true);
    try {
      await requestReset(email);
      toast("인증 코드를 이메일로 발송했어요 📩");
      setStep(2);
    } catch (e) {
      toast(e.response?.data?.message || "발송 중 오류가 발생했어요");
    } finally { setBusy(false); }
  };

  const handleCodeSubmit = async () => {
    if (!code) { toast("인증 코드를 입력해주세요"); return; }
    setBusy(true);
    try {
      const { data } = await verifyReset(email, code);
      if (!data.success) throw new Error(data.message);
      toast("코드가 확인되었어요 ✅");
      setStep(3);
    } catch (e) {
      toast(e.response?.data?.message || e.message || "코드 확인에 실패했어요");
    } finally { setBusy(false); }
  };

  const handlePasswordReset = async () => {
    const passwordError = getPasswordErrorMessage(newPassword);
    if (passwordError) { toast(passwordError); return; }
    if (!confirmPassword) { toast("비밀번호 확인을 입력해주세요"); return; }
    if (newPassword !== confirmPassword) { toast("비밀번호가 일치하지 않습니다"); return; }
    setBusy(true);
    try {
      const { data } = await confirmReset(email, code, newPassword);
      if (!data.success) throw new Error(data.message);
      toast("비밀번호가 재설정되었어요 🎉");
      goLogin();
    } catch (e) {
      toast(e.response?.data?.message || e.message || "재설정에 실패했어요");
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      {step === 1 && (
        <>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>비밀번호 재설정</h2>
          <p style={{ fontSize: 14, color: C.textLight, marginBottom: 28 }}>가입한 이메일을 입력하면 인증 코드를 보내드립니다</p>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>이메일</label>
            <input style={S.formInput} type="email" placeholder="example@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {email && !validateEmail(email) && <p style={{ fontSize: 11, color: C.red, marginTop: 5 }}>⚠ 이메일 형식이 올바르지 않습니다</p>}
          </div>
          <button disabled={busy} style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", padding: 13, fontSize: 15, marginBottom: 16, opacity: busy ? 0.6 : 1 }} onClick={handleEmailSubmit}>{busy ? "발송 중..." : "이메일 보내기"}</button>
          <div style={{ textAlign: "center", fontSize: 13, color: C.textLight }}>
            <span style={{ color: C.purple, fontWeight: 600, cursor: "pointer" }} onClick={goLogin}>로그인으로 돌아가기</span>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>인증 코드 입력</h2>
          <p style={{ fontSize: 14, color: C.textLight, marginBottom: 28 }}>이메일로 받은 인증 코드를 입력해주세요</p>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>인증 코드</label>
            <input style={S.formInput} type="text" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} maxLength="6" />
          </div>
          <button disabled={busy} style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", padding: 13, fontSize: 15, marginBottom: 16, opacity: busy ? 0.6 : 1 }} onClick={handleCodeSubmit}>{busy ? "확인 중..." : "코드 확인"}</button>
          <div style={{ textAlign: "center", fontSize: 13, color: C.textLight }}>
            <span style={{ color: C.purple, fontWeight: 600, cursor: "pointer" }} onClick={() => setStep(1)}>이전 단계로</span>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>비밀번호 재설정</h2>
          <p style={{ fontSize: 14, color: C.textLight, marginBottom: 28 }}>새로운 비밀번호를 입력해주세요</p>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>새 비밀번호</label>
            <input style={S.formInput} type="password" placeholder="8자 이상 입력" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <p style={{ fontSize: 11, color: newPassword && !validatePassword(newPassword) ? C.red : C.textLight, marginTop: 5 }}>
              {newPassword && !validatePassword(newPassword) ? "⚠ 영문, 숫자, 특수문자를 모두 포함해야 합니다" : "영문, 숫자, 특수문자 포함 8자 이상"}
            </p>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>비밀번호 확인</label>
            <input style={S.formInput} type="password" placeholder="비밀번호 재입력" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          <button disabled={busy} style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", padding: 13, fontSize: 15, marginBottom: 16, opacity: busy ? 0.6 : 1 }} onClick={handlePasswordReset}>{busy ? "처리 중..." : "비밀번호 재설정"}</button>
          <div style={{ textAlign: "center", fontSize: 13, color: C.textLight }}>
            <span style={{ color: C.purple, fontWeight: 600, cursor: "pointer" }} onClick={() => setStep(2)}>이전 단계로</span>
          </div>
        </>
      )}
    </AuthLayout>
  );
}

// ── App Shell ──
function Header({ isLoggedIn, onLogout, onLogin, onSignup, onNavTo, sidebarOpen, setSidebarOpen }) {
  const [dd, setDd] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dismissed_notifs") || "[]"); } catch { return []; }
  });
  const dismissNotif = (key, e) => {
    e.stopPropagation();
    setDismissed(prev => {
      const next = [...new Set([...prev, key])];
      localStorage.setItem("dismissed_notifs", JSON.stringify(next));
      return next;
    });
  };
  const user = getUser();

  useEffect(() => {
    const saved = localStorage.getItem('profileImage');
    if (saved) setProfileImage(saved);

    // localStorage 변경 감지 (다른 탭)
    const handleStorageChange = () => {
      const updated = localStorage.getItem('profileImage');
      if (updated) setProfileImage(updated);
    };

    // 같은 탭에서의 변경 감지
    const handleProfileImageUpdated = (e) => {
      setProfileImage(e.detail);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('profileImageUpdated', handleProfileImageUpdated);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('profileImageUpdated', handleProfileImageUpdated);
    };
  }, []);
  const { docs: notifDocs } = useDocuments();
  const isMobile = useIsMobile();
  // 가장 임박한 마감(안 지난 것 중 D-day 최소) — 헤더 칩에 표시
  const upcoming = notifDocs
    .filter(d => d.status === "done" && d.deadlineDate && !ddayInfo(d.deadlineDate).isPast)
    .map(d => ({ d, dd: ddayInfo(d.deadlineDate) }))
    .sort((a, b) => a.dd.days - b.dd.days)[0] || null;
  const notificationsRaw = [];
  let nid = 1;
  // 마감 임박(D-7 이내, 안 지남) 문서 알림
  notifDocs
    .filter(d => d.status === "done" && d.deadlineDate)
    .map(d => ({ d, dd: ddayInfo(d.deadlineDate) }))
    .filter(({ dd }) => !dd.isPast && dd.days !== null && dd.days <= 7)
    .sort((a, b) => a.dd.days - b.dd.days)
    .forEach(({ d, dd }) => {
      const incomplete = d.checks.filter(c => !c.done).length;
      notificationsRaw.push({
        id: nid++, key: `deadline:${d.doc_id}`, type: "highlight", pinned: dd.days <= 3, icon: "📄",
        title: d.title,
        message: incomplete > 0 ? `마감 ${dd.text} · 미완료 서류 ${incomplete}건` : `마감 ${dd.text} · 서류 준비 완료`,
        time: dd.text,
        kind: "deadline",
        doc: d,
      });
    });
  // 최근 분석 완료 문서 알림 (최대 3개)
  notifDocs.filter(d => d.status === "done").slice(0, 3).forEach(d => {
    notificationsRaw.push({
      id: nid++, key: `analysis:${d.doc_id}`, title: d.title, message: "문서 분석이 완료되었습니다", time: d.upload, icon: "✅",
      kind: "analysis",
      doc: d,
    });
  });
  // dismiss(닫기)된 알림 제외
  let visibleNotifs = notificationsRaw.filter(n => !dismissed.includes(n.key));
  const hasNotifs = visibleNotifs.length > 0;   // 실제 알림 존재 여부 (벨 빨간 점 표시 기준)
  if (visibleNotifs.length === 0) {
    visibleNotifs = [{ id: 0, title: "알림 없음", message: "새로운 알림이 없습니다", time: "", icon: "🔔", kind: "empty" }];
  }
  const notifications = [...visibleNotifs.filter(n => n.pinned), ...visibleNotifs.filter(n => !n.pinned)];
  useEffect(() => {
    const h = () => { setDd(false); setNotifOpen(false); };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 58, zIndex: 50, background: C.white, borderBottom: `1px solid ${C.purpleBorder}`, display: "flex", alignItems: "center", padding: "0 24px", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ width: 36, height: 36, borderRadius: 8, border: "none", background: C.purpleBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: C.purple }}>☰</button>
        <div onClick={() => onNavTo("sub-home")} style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 17, color: C.text, cursor: "pointer" }}>
          <img src={logo} alt="LittleBoss" style={{ width: 44, height: 44, borderRadius: 8 }} />
          LittleBoss
        </div>
      </div>
      <span style={{ fontWeight: 700, fontSize: 15, color: C.text }} id="header-title"></span>
      <div style={{ flex: 1 }} />
      {!isLoggedIn ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.btnOutline} onClick={onLogin}>로그인</button>
          <button style={S.btnPrimary} onClick={onSignup}>회원가입</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!isMobile && (upcoming ? (() => {
            const urgent = upcoming.dd.days <= 3;
            const t = upcoming.d.title.length > 14 ? upcoming.d.title.slice(0, 14) + "…" : upcoming.d.title;
            return (
              <span role="button" tabIndex={0}
                onClick={() => onNavTo("schedule-detail", upcoming.d.title)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavTo("schedule-detail", upcoming.d.title); } }}
                title={`${upcoming.d.title} · 마감 ${upcoming.d.deadlineDate}`}
                style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", color: urgent ? C.red : C.purple, background: urgent ? C.redBg : C.purpleBg, padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>
                📌 {t} {upcoming.dd.text}
              </span>
            );
          })() : (
            <span style={{ fontSize: 12, color: C.textLight, background: C.bg, padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>📌 임박한 마감 없음</span>
          ))}
          <div style={{ position: "relative" }}>
            <button aria-label="알림" onClick={e => { e.stopPropagation(); setNotifOpen(!notifOpen); setDd(false); }} style={{ width: 36, height: 36, borderRadius: 10, background: C.purpleBg, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: C.purple, position: "relative" }}>
              🔔{hasNotifs && <span style={{ position: "absolute", top: 7, right: 7, width: 7, height: 7, borderRadius: "50%", background: C.red, border: "1.5px solid white" }} />}
            </button>
            {notifOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 12px)", right: 0, background: "white", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", width: 320, maxHeight: 400, overflowY: "auto", zIndex: 200 }}>
                <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.purpleBorder}`, fontSize: 13, fontWeight: 700 }}>알림</div>
                {notifications.length > 0 ? (
                  <div>
                    {notifications.map(notif => {
                      let bgColor = "transparent";
                      let titleColor = C.text;
                      let messageColor = C.textMid;
                      if (notif.type === "highlight") {
                        bgColor = "#FFF0F0";
                        titleColor = C.text;
                        messageColor = C.text;
                      }
                      const handleNotifClick = () => {
                        setNotifOpen(false);
                        if (notif.kind === "deadline") {
                          onNavTo("schedule-detail", notif.doc.title);
                        } else if (notif.kind === "analysis") {
                          onNavTo("doc-detail", null, notif.doc);
                        }
                      };
                      const clickable = notif.kind === "deadline" || notif.kind === "analysis";
                      return (
                        <div key={notif.id} onClick={clickable ? handleNotifClick : undefined} style={{ padding: "12px 14px", borderBottom: `1px solid ${C.purpleBorder}`, cursor: clickable ? "pointer" : "default", transition: "background 0.2s", background: bgColor }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            {notif.pinned && notif.type === "highlight" && <span style={{ fontSize: 16, flexShrink: 0, marginRight: -2 }}>📌</span>}
                            <span style={{ fontSize: 18 }}>{notif.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: titleColor, marginBottom: 2 }}>{notif.title}</div>
                              <div style={{ fontSize: 11, color: messageColor, marginBottom: 4, lineHeight: 1.3 }}>{notif.message}</div>
                              <div style={{ fontSize: 10, color: C.textLight }}>{notif.time}</div>
                            </div>
                            {notif.kind !== "empty" && (
                              <button onClick={(e) => dismissNotif(notif.key, e)} title="알림 닫기" aria-label="알림 닫기" style={{ background: "none", border: "none", cursor: "pointer", color: C.textLight, fontSize: 15, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>✕</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: "20px", textAlign: "center", color: C.textLight, fontSize: 12 }}>알림이 없습니다</div>
                )}
              </div>
            )}
          </div>
          <div style={{ position: "relative" }} onClick={e => { e.stopPropagation(); setDd(p => !p); setNotifOpen(false); }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 10px 4px 4px", borderRadius: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: profileImage ? "white" : `linear-gradient(135deg,${C.purple},${C.purpleLight})`, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 13, fontWeight: 700, overflow: "hidden" }}>
                {profileImage ? (
                  <img src={profileImage} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  (user.name || "사")[0]
                )}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{user.name}</span>
              <span style={{ fontSize: 11, color: C.textLight }}>▾</span>
            </div>
            {dd && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "white", borderRadius: 12, padding: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", minWidth: 130, zIndex: 200 }}>
                {[{ label: "내 정보", action: () => { onNavTo("sub-profile"); setDd(false); } },
                  { label: "로그아웃", action: () => { onLogout(); setDd(false); }, danger: true }
                ].map(item => (
                  <div key={item.label} onClick={(e) => { e.stopPropagation(); item.action(); }} style={{ padding: "9px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", color: item.danger ? C.red : C.text }}>
                    {item.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ currentSub, onNavTo, sidebarOpen }) {
  const [subOpen, setSubOpen] = useState(false);
  const navItem = (id, icon, label, active) => (
    <div onClick={() => onNavTo(id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "white" : C.textMid, background: active ? C.purple : "transparent", cursor: "pointer", marginBottom: 2 }}>
      <span style={{ fontSize: 15, width: 18, textAlign: "center" }}>{icon}</span>{label}
    </div>
  );
  const isDocsSub = ["sub-schedule","sub-ongoing","sub-expired"].includes(currentSub);
  return (
    <aside style={{ width: 200, flexShrink: 0, background: C.white, borderRight: `1px solid ${C.purpleBorder}`, position: "fixed", top: 58, bottom: 0, zIndex: 45, padding: "20px 12px", overflowY: "auto", transform: sidebarOpen ? "translateX(0)" : "translateX(-200px)", opacity: sidebarOpen ? 1 : 0, transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)", pointerEvents: sidebarOpen ? "auto" : "none" }}>
      {navItem("sub-home", "🏠", "대시보드", currentSub === "sub-home")}
      {navItem("sub-upload", "📎", "문서 업로드", currentSub === "sub-upload")}
      <div onClick={() => setSubOpen(p => !p)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: 500, color: isDocsSub ? C.purple : C.textMid, cursor: "pointer", marginBottom: 2 }}>
        <span style={{ fontSize: 15, width: 18, textAlign: "center" }}>📁</span>
        내 문서 관리
        <span style={{ marginLeft: "auto", fontSize: 18, transition: "transform .25s", transform: subOpen ? "rotate(180deg)" : "none" }}>▾</span>
      </div>
      {subOpen && (
        <div style={{ paddingLeft: 16 }}>
          {[["sub-schedule","📅","일정 관리"],["sub-ongoing","📋","진행 중인 문서"],["sub-expired","🗂️","마감된 문서"]].map(([id,icon,label]) => (
            <div key={id} onClick={() => onNavTo(id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, fontSize: 12.5, color: currentSub === id ? C.purple : C.textMid, fontWeight: currentSub === id ? 600 : 400, cursor: "pointer", marginBottom: 2 }}>
              {icon} {label}
            </div>
          ))}
        </div>
      )}
      {navItem("sub-profile", "👤", "내 정보", currentSub === "sub-profile")}
    </aside>
  );
}

// ── Sub pages ──
function Dashboard({ onNavTo }) {
  const { docs: serverDocs, loading } = useDocuments();
  const isMobile = useIsMobile();
  const recentDocs = serverDocs
    .filter(d => d.status === "done")
    .map(d => {
      const dd = ddayInfo(d.deadlineDate);
      const done = d.checks.filter(c => c.done).length;
      const allDone = d.total > 0 && done === d.total;
      const status = allDone ? "완료" : dd.isPast ? "미완료" : "진행 중";
      return {
        name: d.filename || d.title,
        date: `${d.upload}${d.deadlineDate ? ` · 마감 ${dd.text}` : ""}`,
        status,
        color: STATUS[status].color,
        bg: STATUS[status].bg,
        title: d.title,
        deadline: d.deadlineDate || "마감일 없음",
        ago: dd.text,
        done, total: d.total,
        summary: d.summary,
        upload: d.upload,
        documents: d.checks.map(c => c.l),
      };
    });
  // 마감 임박 문서: 마감 안 지난 것 중 D-day 가장 가까운 1개
  const urgentDoc = serverDocs
    .filter(d => d.status === "done" && d.deadlineDate && !ddayInfo(d.deadlineDate).isPast)
    .map(d => ({ ...d, _days: ddayInfo(d.deadlineDate).days ?? 99999 }))
    .sort((a, b) => a._days - b._days)[0] || null;
  const _today = new Date();
  const [month, setMonth] = useState(_today.getMonth() + 1);
  const [year, setYear] = useState(_today.getFullYear());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDocFilter, setShowDocFilter] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [hoverDetailList, setHoverDetailList] = useState(false);
  const [search, setSearch] = useState("");
  const [hoverMonth, setHoverMonth] = useState(false);

  // 초기 로딩 중에는 카드가 빈 채로 깜빡이지 않도록 스켈레톤 표시
  if (loading) return <Skeleton rows={3} />;

  // 최근 문서: 검색어(문서명) + 상태 필터 적용
  const filteredDocs = recentDocs.filter(
    d => (!search.trim() || d.name.toLowerCase().includes(search.trim().toLowerCase()))
      && (!selectedStatus || d.status === selectedStatus)
  );

  const monthNames = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
  const getDaysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const getFirstDayOfMonth = (y, m) => new Date(y, m - 1, 1).getDay();

  const handlePrevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const handleNextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  // 실제 문서 마감일 → 현재 보는 달의 일별 이벤트
  const monthEvents = deadlinesForMonth(serverDocs, year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div><div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{greeting()}, {getUser().name}님 👋</div><div style={{ fontSize: 14, color: C.textLight }}>오늘 처리해야 할 행정 문서와 일정을 확인하세요.</div></div>
        <button style={S.btnPrimary} onClick={() => onNavTo("sub-upload")}>📎 새 문서 업로드</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Left card */}
        <div role={urgentDoc ? "button" : undefined} tabIndex={urgentDoc ? 0 : undefined} aria-label={urgentDoc ? `${urgentDoc.title} 상세 보기` : undefined} onKeyDown={(e) => { if (urgentDoc && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onNavTo('schedule-detail', urgentDoc.title); } }} style={{...S.card, cursor: urgentDoc ? 'pointer' : 'default', transition: 'all 0.2s'}} onClick={() => urgentDoc && onNavTo('schedule-detail', urgentDoc.title)} onMouseEnter={(e) => { if (urgentDoc) e.currentTarget.style.boxShadow = '0 12px 32px rgba(107,79,232,0.15)'; }} onMouseLeave={(e) => e.currentTarget.style.boxShadow = S.card.boxShadow}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>마감 임박 문서</div>
          {!urgentDoc ? (
            <div style={{ fontSize: 13, color: C.textLight, padding: "30px 0", textAlign: "center" }}>마감 임박 문서가 없습니다.</div>
          ) : (() => {
            const dd = ddayInfo(urgentDoc.deadlineDate);
            const incomplete = urgentDoc.checks.filter(c => !c.done);
            const doneCnt = urgentDoc.total - incomplete.length;
            const pct = urgentDoc.total ? Math.round(doneCnt / urgentDoc.total * 100) : 0;
            const circ = 163;
            const offset = circ * (1 - pct / 100);
            const urgent = dd.days !== null && dd.days <= 3;
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ background: urgent ? C.redBg : C.purpleBg, color: urgent ? C.red : C.purple, fontWeight: 700, fontSize: 15, padding: "5px 12px", borderRadius: 8 }}>{dd.text}</span>
                  <div style={{ textAlign: "right" }}><div style={{ fontWeight: 700, fontSize: 14 }}>{urgentDoc.title}</div><div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>마감 기한 | {urgentDoc.deadlineDate}</div></div>
                </div>
                <hr style={{ border: "none", borderTop: `1px solid ${C.purpleBorder}`, margin: "14px 0" }} />
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>미완료 서류</div>
                {incomplete.length === 0
                  ? <div style={{ fontSize: 13, color: C.green, marginBottom: 4 }}>· 모든 서류 준비 완료 ✅</div>
                  : incomplete.map((c, i) => <div key={i} style={{ fontSize: 13, color: C.textMid, marginBottom: 4 }}>· {c.l}</div>)}
                <hr style={{ border: "none", borderTop: `1px solid ${C.purpleBorder}`, margin: "14px 0" }} />
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>준비물 달성률</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <svg width="64" height="64" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="26" fill="none" stroke={C.track} strokeWidth="6"/>
                    <circle cx="32" cy="32" r="26" fill="none" stroke={C.purple} strokeWidth="6" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 32 32)"/>
                    <text x="32" y="32" textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="700" fill={C.purple}>{pct}%</text>
                  </svg>
                  <div style={{ fontSize: 12, color: C.textMid, display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: C.purple, display: "inline-block" }} />준비 완료 {doneCnt}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#DDD", display: "inline-block" }} />미완료 {incomplete.length}</span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
        {/* Calendar card */}
        <div style={{ ...S.card, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>다가오는 일정</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, position: "relative" }}>
            <div role="button" tabIndex={0} aria-label="연·월 선택" aria-expanded={showDatePicker}
              onClick={() => setShowDatePicker(!showDatePicker)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowDatePicker(!showDatePicker); } }}
              onMouseEnter={() => setHoverMonth(true)} onMouseLeave={() => setHoverMonth(false)}
              style={{ fontSize: 15, fontWeight: 700, cursor: "pointer", padding: "6px 12px", borderRadius: 8, background: (hoverMonth || showDatePicker) ? C.bg : "transparent", transition: "background 0.15s" }}>
              {year}년 {monthNames[month - 1]} ▾
            </div>
            {/* 범례 */}
            <div style={{ display: "flex", gap: 14, fontSize: 11, flex: 1, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.ongoing }}></div>
                <span style={{ color: C.textLight }}>진행중</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green }}></div>
                <span style={{ color: C.textLight }}>완료</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.red }}></div>
                <span style={{ color: C.textLight }}>미완료</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button aria-label="이전 달" onClick={handlePrevMonth} style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid " + C.border, background: "white", cursor: "pointer", fontSize: 16, color: C.textMid }}>‹</button>
              <button aria-label="다음 달" onClick={handleNextMonth} style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid " + C.border, background: "white", cursor: "pointer", fontSize: 16, color: C.textMid }}>›</button>
            </div>
            {showDatePicker && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, background: "white", borderRadius: 12, padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 10, minWidth: 240 }}>
                <div style={{ marginBottom: 12, fontWeight: 700, fontSize: 13 }}>연도 선택</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16 }}>
                  {[2024,2025,2026,2027,2028,2029,2030,2031].map(y => (
                    <button key={y} onClick={() => { setYear(y); }} style={{ padding: "8px 0", borderRadius: 6, border: y===year ? "2px solid " + C.purple : "1.5px solid " + C.border, background: y===year ? C.purpleBg : "white", color: y===year ? C.purple : C.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{y}</button>
                  ))}
                </div>
                <div style={{ marginBottom: 12, fontWeight: 700, fontSize: 13 }}>월 선택</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {monthNames.map((m, i) => (
                    <button key={i} onClick={() => { setMonth(i+1); setShowDatePicker(false); }} style={{ padding: "8px 0", borderRadius: 6, border: (i+1)===month ? "2px solid " + C.purple : "1.5px solid " + C.border, background: (i+1)===month ? C.purpleBg : "white", color: (i+1)===month ? C.purple : C.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{m}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, rowGap: 8, textAlign: "center" }}>
            {["일","월","화","수","목","금","토"].map(d => <div key={d} style={{ fontSize: 10, color: C.textLight, paddingBottom: 6 }}>{d}</div>)}
            {calendarDays.map((d, i) => {
              const ev = d ? monthEvents[d] : null;
              const colorMap = { ongoing: C.ongoing, completed: C.green, incomplete: C.red };
              const bgColorMap = { ongoing: C.ongoingBg, completed: C.greenBg, incomplete: C.redBg };
              const st = ev?.status;
              const isToday = d && year === _today.getFullYear() && month === _today.getMonth() + 1 && d === _today.getDate();
              return (
                <div key={i} title={ev ? ev.title : ""} role={ev ? "button" : undefined} tabIndex={ev ? 0 : undefined}
                  onClick={() => ev && onNavTo("schedule-detail", ev.title)}
                  onKeyDown={(e) => { if (ev && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onNavTo("schedule-detail", ev.title); } }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: st ? colorMap[st] : isToday ? C.todayText : C.textMid, fontWeight: st || isToday ? 600 : 400, width: 24, height: 24, borderRadius: "50%", background: st ? bgColorMap[st] : (isToday ? C.todayBg : "transparent"), margin: "0 auto", cursor: st ? "pointer" : "default" }}>
                  {d}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "center", marginTop: "auto", paddingTop: 20 }}>
            <span role="button" tabIndex={0} onClick={() => onNavTo("sub-schedule")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavTo("sub-schedule"); } }} onMouseEnter={() => setHoverDetailList(true)} onMouseLeave={() => setHoverDetailList(false)} style={{ fontSize: 12, color: C.purple, cursor: "pointer", fontWeight: 600, transform: hoverDetailList ? "scale(1.15)" : "scale(1)", transition: "transform 0.2s ease-in-out", display: "inline-block" }}>상세 목록 보기</span>
          </div>
        </div>
      </div>
      {/* Recent docs */}
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>최근 분석된 문서</div>
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "7px 12px", border: "1.5px solid " + C.border, borderRadius: 8, fontSize: 12, outline: "none", fontFamily: "inherit", width: 180 }} placeholder="🔍 문서명 검색" />
            <button onClick={() => setShowDocFilter(!showDocFilter)} style={{ ...(selectedStatus ? S.btnPrimary : S.btnOutline), fontSize: 12, padding: "7px 14px" }}>필터{selectedStatus ? ` · ${selectedStatus}` : ""}</button>
            {showDocFilter && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "white", borderRadius: 12, padding: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", zIndex: 20, minWidth: 240 }}>
                <div style={{ marginBottom: 12, fontWeight: 700, fontSize: 13 }}>상태별</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { label: "진행 중", value: "진행 중", color: C.ongoing },
                    { label: "완료", value: "완료", color: C.green },
                    { label: "미완료", value: "미완료", color: C.red }
                  ].map(status => (
                    <label key={status.value} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, cursor: "pointer", padding: "6px 0" }}>
                      <input
                        type="checkbox"
                        checked={selectedStatus === status.value}
                        onChange={() => setSelectedStatus(selectedStatus === status.value ? null : status.value)}
                        style={{ accentColor: status.color, width: 16, height: 16, cursor: "pointer" }}
                      />
                      <span style={{ color: C.textMid }}>{status.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {filteredDocs.length === 0 && (
          <div style={{ textAlign: "center", color: C.textLight, fontSize: 13, padding: "28px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.8 }}>{recentDocs.length === 0 ? "📄" : "🔍"}</div>
            {recentDocs.length === 0 ? "아직 분석된 문서가 없습니다." : "조건에 맞는 문서가 없습니다."}
          </div>
        )}
        {filteredDocs.map(doc => (
          <div
            key={doc.name}
            role="button"
            tabIndex={0}
            aria-label={`${doc.name} 상세 보기`}
            onClick={() => onNavTo("doc-detail", null, doc)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavTo("doc-detail", null, doc); } }}
            style={{
              background: "white",
              border: "1px solid " + C.border,
              borderRadius: 10,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 8,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 4px 16px rgba(107,79,232,0.1)"}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = "none"}
          >
            <span style={{ fontSize: 22 }}>📄</span>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{doc.name}</div><div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{doc.date}</div></div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: doc.bg, color: doc.color }}>{doc.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadPage({ onNavTo }) {
  const [queue, setQueue] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [uploadConfirm, setUploadConfirm] = useState(false);
  const [fileToUpload, setFileToUpload] = useState(null);
  const [checkedFiles, setCheckedFiles] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [calMsg, setCalMsg] = useState("");
  const fileInputRef = useRef(null);
  const { docs: serverDocs } = useDocuments();
  const recentFiles = serverDocs
    .filter(d => d.status === "done")
    .map(d => ({ id: d.doc_id, icon: "📄", name: d.filename || d.title, date: d.upload, done: true, scheduleTitle: d.title }));
  const addFiles = async (files) => {
    const userId = localStorage.getItem("user_id") || "anonymous";
    const list = [...files];
    const items = list.map(f => ({ name: f.name, size: f.size > 1048576 ? (f.size/1048576).toFixed(1)+"MB" : (f.size/1024).toFixed(0)+"KB", progress: 0, id: Date.now() + f.name }));
    setQueue(q => [...q, ...items]);
    setErrMsg("");

    for (let idx = 0; idx < list.length; idx++) {
      const file = list[idx];
      const item = items[idx];
      const setP = (p, extra = {}) => setQueue(q => q.map(i => i.id === item.id ? { ...i, progress: p, ...extra } : i));
      try {
        setP(25);
        const { data } = await uploadFile(file, userId);
        if (!data.success) throw new Error(data.message || "업로드 실패");
        setP(55);
        setAnalyzing(true);
        const doc = await pollUntilDone(data.doc_id, {
          onTick: () => setQueue(q => q.map(i => i.id === item.id ? { ...i, progress: Math.min((i.progress || 55) + 4, 95) } : i)),
        });
        setP(100);
        setAnalysis({ ...(doc.analysis || {}), doc_id: data.doc_id, filename: file.name });

        // 분석 완료 → Google 로그인 상태면 캘린더 자동 등록
        const a = doc.analysis || {};
        const token = localStorage.getItem("user_token");
        const evCount = (a.calendar_events || []).length;
        if (evCount > 0 && token) {
          setCalMsg("📅 캘린더에 일정 등록 중...");
          try {
            const { data: cal } = await registerCalendar(data.doc_id, token);
            setCalMsg(cal.success ? `📅 ${cal.message}` : `캘린더 등록 실패: ${cal.message}`);
          } catch (er) {
            setCalMsg("캘린더 자동 등록 실패: " + (er.response?.data?.message || er.message));
          }
        } else if (evCount > 0 && !token) {
          setCalMsg("ℹ️ Google 로그인하면 일정이 캘린더에 자동 등록됩니다.");
        }
      } catch (e) {
        setErrMsg(`${file.name}: ${e.message || "처리 실패"}`);
        setP(100, { failed: true });
      } finally {
        setAnalyzing(false);
      }
    }
  };

  const handleFileSelect = (files) => {
    if (files && files.length > 0) {
      setFileToUpload(files);
      setUploadConfirm(true);
    }
  };

  const handleConfirmUpload = () => {
    addFiles(fileToUpload);
    // 팝업은 열린 상태로 유지하여 업로드 진행 상황 표시
  };

  const handleCancelUpload = () => {
    setUploadConfirm(false);
    setFileToUpload(null);
  };

  // 모든 파일 업로드 완료 시 팝업 자동 닫기
  useEffect(() => {
    if (uploadConfirm && queue.length > 0 && queue.every(f => f.progress === 100)) {
      setTimeout(() => {
        setUploadConfirm(false);
        setFileToUpload(null);
      }, 800);
    }
  }, [queue, uploadConfirm]);
  return (
    <div>
      <div style={{ marginBottom: 24 }}><div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>문서 업로드</div><div style={{ fontSize: 14, color: C.textLight }}>분석할 문서를 업로드하면 AI가 서류·마감일을 자동 추출합니다.</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
        <div>
          <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFileSelect(e.dataTransfer.files); }}
            style={{ border: `2px dashed ${dragging ? C.purple : C.purpleBorder}`, borderRadius: 16, padding: "60px 40px", textAlign: "center", background: dragging ? C.purpleBg : "white", cursor: "pointer", transition: "all .2s" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>여기에 파일을 드래그 & 드롭하세요</div>
            <div style={{ fontSize: 13, color: C.textLight, lineHeight: 1.6 }}>또는 아래 버튼으로 파일을 선택하세요<br/>PDF · DOCX · HWPX · 이미지 · TXT 지원 · 최대 20MB</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24 }}>
              <label style={{ ...S.btnPrimary, padding: "10px 20px" }}>📁 파일 선택<input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.hwpx,.txt,.md,.csv,.jpg,.jpeg,.png,.gif,.webp,.tiff,.tif" style={{ display: "none" }} onChange={e => handleFileSelect(e.target.files)} /></label>
            </div>
            <div style={{ fontSize: 11, color: C.textLight, marginTop: 12 }}>지원 형식: PDF · DOCX · HWPX · JPG · PNG · TXT (HWP/DOC 구버전은 PDF 변환 권장)</div>
          </div>
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            {queue.map(f => (
              <div key={f.id} style={{ background: "white", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 24 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{f.size}</div>
                  <div style={{ height: 3, background: C.track, borderRadius: 2, marginTop: 6 }}><div style={{ height: "100%", borderRadius: 2, background: C.purple, width: f.progress + "%", transition: "width .3s" }} /></div>
                </div>
                <input type="checkbox" checked={checkedFiles[f.id] || false} onChange={(e) => { setCheckedFiles(prev => ({ ...prev, [f.id]: e.target.checked })); }} style={{ width: 18, height: 18, cursor: "pointer", accentColor: C.purple }} />
              </div>
            ))}
            {queue.length > 0 && (
              <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
                <button onClick={() => { setQueue([]); setAnalysis(null); setErrMsg(""); setCalMsg(""); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={{ ...S.btnOutline, fontSize: 13 }}>초기화</button>
              </div>
            )}
            {analyzing && (
              <div style={{ background: C.purpleBg, borderRadius: 10, padding: "14px 16px", fontSize: 13, color: C.purple, fontWeight: 600 }}>
                🤖 AI가 문서를 분석하고 있습니다... (15~30초 소요)
              </div>
            )}
            {errMsg && (
              <div style={{ background: C.redBg, borderRadius: 10, padding: "14px 16px", fontSize: 13, color: C.red, fontWeight: 500 }}>
                ⚠️ {errMsg}
              </div>
            )}
            {analysis && (
              <div style={{ ...S.card, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 4 }}>{analysis.document_type || "분석 결과"}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{analysis.filename}</div>
                <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, marginBottom: 16 }}>{analysis.summary}</div>

                {(analysis.deadlines || []).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📅 마감일</div>
                    {analysis.deadlines.map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: C.bg, borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                        <span style={{ fontWeight: 700, color: d.urgency === "high" ? C.red : C.purple }}>{d.date}</span>
                        <span style={{ color: C.textMid }}>{d.description}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(analysis.required_documents || []).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📋 준비 서류</div>
                    {analysis.required_documents.map((d, i) => (
                      <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" style={{ width: 16, height: 16, accentColor: C.purple }} />
                        <span style={{ fontWeight: 600 }}>{d.name}</span>
                        <span style={{ color: C.textLight, fontSize: 12 }}>{d.description}</span>
                      </label>
                    ))}
                  </div>
                )}

                {(analysis.calendar_events || []).length > 0 && (
                  <>
                    {calMsg && (
                      <div style={{ background: calMsg.startsWith("📅") ? C.greenBg : C.purpleBg, color: calMsg.startsWith("📅") ? C.green : C.purple, borderRadius: 10, padding: "12px 14px", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                        {calMsg}
                      </div>
                    )}
                    <button
                      onClick={async () => {
                        const token = localStorage.getItem("user_token");
                        if (!token) { setCalMsg("ℹ️ Google 로그인하면 일정이 캘린더에 등록됩니다."); return; }
                        setCalMsg("📅 캘린더에 일정 등록 중...");
                        try {
                          const { data } = await registerCalendar(analysis.doc_id, token);
                          setCalMsg(data.success ? `📅 ${data.message}` : `캘린더 등록 실패: ${data.message}`);
                        } catch (e) {
                          setCalMsg("캘린더 등록 실패: " + (e.response?.data?.message || e.message));
                        }
                      }}
                      style={{ ...S.btnOutline, width: "100%", justifyContent: "center" }}
                    >
                      📅 캘린더에 다시 등록 ({(analysis.calendar_events || []).length}개)
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {/* Recent panel */}
        <div style={{ background: "white", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.purpleBorder}`, fontSize: 13, fontWeight: 700 }}>📋 분석 완료 파일</div>
          <div style={{ padding: 8, maxHeight: 520, overflowY: "auto" }}>
            {recentFiles.map(f => (
              <div key={f.id} onClick={() => f.scheduleTitle && onNavTo("schedule-detail", f.scheduleTitle)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px", borderRadius: 9, cursor: f.scheduleTitle ? "pointer" : "default", marginBottom: 2, transition: "all 0.2s", background: "transparent", opacity: f.scheduleTitle ? 1 : 0.5, hover: f.scheduleTitle ? { background: C.purpleBg } : {} }}>
                <span style={{ fontSize: 20 }}>{f.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{f.date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 업로드 확인 팝업 */}
      {uploadConfirm && fileToUpload && queue.length === 0 && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 14, padding: 28, textAlign: "center", maxWidth: 380, boxShadow: "0 20px 48px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>파일 업로드</div>
            <div style={{ fontSize: 13, color: C.textLight, marginBottom: 24, lineHeight: 1.6 }}>
              {[...fileToUpload].slice(0, 2).map(f => f.name).join(", ")}
              {fileToUpload.length > 2 ? ` 외 ${fileToUpload.length - 2}개` : ""}
              <br/>파일을 업로드 하시겠습니까?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleCancelUpload} style={{ ...S.btnOutline, flex: 1, fontSize: 13, justifyContent: "center" }}>취소</button>
              <button onClick={handleConfirmUpload} style={{ ...S.btnPrimary, flex: 1, fontSize: 13, justifyContent: "center" }}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 업로드 진행 중 팝업 */}
      {uploadConfirm && queue.length > 0 && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 14, padding: 28, maxWidth: 420, boxShadow: "0 20px 48px rgba(0,0,0,0.2)", maxHeight: 500, overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, textAlign: "center" }}>파일 업로드 중</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {queue.map(f => (
                <div key={f.id} style={{ background: C.purpleBg, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 18 }}>📄</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text }}>{f.name}</div>
                      <div style={{ fontSize: 10, color: C.textLight, marginTop: 2 }}>{f.size}</div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.purple, minWidth: 40, textAlign: "right" }}>{Math.round(f.progress)}%</div>
                  </div>
                  <div style={{ height: 4, background: "#E5E7EB", borderRadius: 2 }}>
                    <div style={{ height: "100%", borderRadius: 2, background: C.purple, width: f.progress + "%", transition: "width .3s" }} />
                  </div>
                </div>
              ))}
            </div>
            {queue.every(f => f.progress === 100) && (
              <div style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: C.green, fontWeight: 600 }}>✅ 업로드 완료</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SchedulePage({ onNavTo }) {
  const { docs, loading, error } = useDocuments();
  const isMobile = useIsMobile();
  const now = new Date();
  const [calY, setCalY] = useState(now.getFullYear());
  const [calM, setCalM] = useState(now.getMonth() + 1); // 1~12
  const prevMonth = () => { if (calM === 1) { setCalM(12); setCalY(calY - 1); } else setCalM(calM - 1); };
  const nextMonth = () => { if (calM === 12) { setCalM(1); setCalY(calY + 1); } else setCalM(calM + 1); };

  // 동적 캘린더 그리드
  const firstDow = new Date(calY, calM - 1, 1).getDay();
  const daysInM = new Date(calY, calM, 0).getDate();
  const grid = [];
  for (let i = 0; i < firstDow; i++) grid.push(null);
  for (let i = 1; i <= daysInM; i++) grid.push(i);

  const monthEvents = deadlinesForMonth(docs, calY, calM);
  const isToday = (d) => d === now.getDate() && calM === now.getMonth() + 1 && calY === now.getFullYear();
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  // 실제 문서의 마감 일정 목록 (가까운 순)
  const scheduleList = docs
    .filter(d => d.deadlineDate)
    .map(d => {
      const dd = ddayInfo(d.deadlineDate);
      const dt = new Date(d.deadlineDate);
      return {
        doc_id: d.doc_id, title: d.title,
        items: "· " + (d.checks.map(c => c.l).slice(0, 4).join(" · ") || "준비 서류 없음"),
        day: isNaN(dt) ? "-" : dt.getDate(),
        month: isNaN(dt) ? "" : MON[dt.getMonth()],
        dday: dd.text, passed: dd.isPast,
        ddayColor: dd.isPast ? C.textLight : (dd.days !== null && dd.days <= 3 ? C.red : C.purple),
        ddayBg: dd.isPast ? C.bg : (dd.days !== null && dd.days <= 3 ? C.redBg : C.purpleBg),
        sortKey: dd.days === null ? 99999 : dd.days,
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div><div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>일정 관리</div><div style={{ fontSize: 14, color: C.textLight }}>문서별 마감일을 한눈에 확인하세요.</div></div>
        <button style={S.btnPrimary}>📅 캘린더 동기화</button>
      </div>
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{calY}년 {calM}월</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={prevMonth} style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid " + C.border, background: "white", cursor: "pointer", fontSize: 16, color: C.textMid }}>‹</button>
            <button onClick={nextMonth} style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid " + C.border, background: "white", cursor: "pointer", fontSize: 16, color: C.textMid }}>›</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, textAlign: "center" }}>
          {["일","월","화","수","목","금","토"].map(d => <div key={d} style={{ fontSize: 11, fontWeight: 600, color: C.textLight, paddingBottom: 8, letterSpacing: "0.05em" }}>{d}</div>)}
          {grid.map((d, i) => {
            const ev = d ? monthEvents[d] : null;
            const today = d && isToday(d);
            const bgColorMap = { incomplete: C.redBg, ongoing: C.ongoingBg, completed: C.greenBg };
            const colorMap = { incomplete: C.red, ongoing: C.ongoing, completed: C.green };
            return (
              <div key={i} title={ev ? ev.title : ""} onClick={() => ev && onNavTo('schedule-detail', ev.title)} style={{ minHeight: isMobile ? 46 : 90, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start", fontSize: 13, borderRadius: 8, cursor: ev ? "pointer" : "default", padding: isMobile ? 4 : 8,
                color: today ? C.todayText : ev ? colorMap[ev.status] : C.textMid,
                background: ev ? bgColorMap[ev.status] : (today ? C.todayBg : "transparent"), fontWeight: (ev || today) ? 700 : 400, position: "relative", transition: "all 0.2s" }}
                onMouseEnter={(e) => { if (ev && !isMobile) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; }}}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{d || ""}</span>
                {ev && !isMobile && (
                  <span style={{ fontSize: 9, fontWeight: 500, color: colorMap[ev.status], marginTop: 4, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {ev.title}
                  </span>
                )}
                {ev && isMobile && (
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: colorMap[ev.status], marginTop: 3 }} />
                )}
              </div>
            );
          })}
        </div>
        {/* 범례 */}
        <div style={{ display: "flex", gap: 20, padding: "12px 0", borderTop: `1px solid ${C.border}`, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: C.ongoing }}></div>
            <span style={{ color: C.textLight }}>진행중</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: C.green }}></div>
            <span style={{ color: C.textLight }}>완료</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: C.red }}></div>
            <span style={{ color: C.textLight }}>미완료</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>마감 일정 목록</div>
      {loading && <Skeleton rows={3} />}
      {error && <div style={{ ...S.card, color: C.red }}>⚠️ {error}</div>}
      {!loading && !error && scheduleList.length === 0 && (
        <EmptyState icon="📅" title="마감 일정이 없습니다" desc="문서를 업로드하면 마감 일정이 자동으로 정리됩니다." actionLabel="문서 업로드" onAction={() => onNavTo("sub-upload")} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {scheduleList.map(item => (
          <div key={item.doc_id} onClick={() => onNavTo("schedule-detail", item.title)} style={{ background: "white", borderRadius: 12, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ minWidth: 56, textAlign: "center", background: item.passed ? C.bg : C.purpleBg, borderRadius: 10, padding: "8px 6px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: item.passed ? C.textLight : C.purple, letterSpacing: "0.08em" }}>{item.month}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: item.passed ? C.textLight : C.purple, lineHeight: 1 }}>{item.day}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: C.textMid }}>{item.items}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: item.ddayBg, color: item.ddayColor }}>{item.dday}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OngoingPage({ onNavTo, toast }) {
  const { docs, loading, error, reload } = useDocuments();
  const [checkState, setCheckState] = useState({}); // `${docId}::${name}` -> bool (낙관적 오버라이드)
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (e, docId, title) => {
    e.stopPropagation();
    if (!window.confirm(`'${title}' 문서를 삭제할까요? (복구 불가)`)) return;
    setDeletingId(docId);
    try {
      await deleteDocument(docId);
      reload?.();
    } catch (err) {
      toast("삭제 실패: " + (err.response?.data?.message || err.message));
    } finally {
      setDeletingId(null);
    }
  };
  // 진행 중 = 분석 완료(done) & 마감 안 지남
  const ongoing = docs.filter(d => {
    if (d.status !== "done") return d.status !== "error"; // 처리중 문서도 표시
    const dd = ddayInfo(d.deadlineDate);
    return !dd.isPast;
  });

  const toggleCheck = async (docId, name, current) => {
    const key = `${docId}::${name}`;
    const next = !current;
    setCheckState(s => ({ ...s, [key]: next })); // 즉시 반영
    try {
      const { data } = await updateChecklistItem(docId, name, next);
      if (!data.success) throw new Error(data.message || "저장 실패");
    } catch (e) {
      setCheckState(s => ({ ...s, [key]: current })); // 롤백
      toast("체크리스트 저장 실패: " + (e.response?.data?.message || e.message));
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}><div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>진행 중인 문서</div><div style={{ fontSize: 14, color: C.textLight }}>준비 중인 서류를 체크리스트로 관리하세요.</div></div>
      {loading && <Skeleton rows={3} />}
      {error && <div style={{ ...S.card, color: C.red }}>⚠️ {error}</div>}
      {!loading && !error && ongoing.length === 0 && (
        <EmptyState icon="📂" title="진행 중인 문서가 없습니다" desc="새 문서를 업로드하면 분석 후 여기에서 진행 상황을 관리할 수 있어요." actionLabel="문서 업로드" onAction={() => onNavTo("sub-upload")} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {ongoing.map(doc => {
          const dd = ddayInfo(doc.deadlineDate);
          const checks = doc.checks.map(c => {
            const key = `${doc.doc_id}::${c.l}`;
            return { ...c, done: key in checkState ? checkState[key] : c.done };
          });
          const doneCount = checks.filter(c => c.done).length;
          const percentage = doc.total ? (doneCount / doc.total) * 100 : 0;
          const processing = doc.status !== "done";

          return (
            <div key={doc.doc_id} onClick={() => onNavTo("schedule-detail", doc.title)} style={{ ...S.card, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: C.text }}>{doc.title}</div>
                  <div style={{ fontSize: 12, color: C.textLight }}>📎 업로드: {doc.upload} · {processing ? "분석 중..." : "분석 완료"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: dd.days !== null && dd.days <= 3 ? C.redBg : C.purpleBg, color: dd.days !== null && dd.days <= 3 ? C.red : C.purple }}>
                    {doc.deadlineDate ? `마감 ${doc.deadlineDate} · ${dd.text}` : "마감일 없음"}
                  </span>
                  <button onClick={(e) => handleDelete(e, doc.doc_id, doc.title)} disabled={deletingId === doc.doc_id} title="삭제" aria-label={`${doc.title} 삭제`} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, opacity: deletingId === doc.doc_id ? 0.4 : 0.6, padding: 2 }}>🗑️</button>
                  <span style={{ fontSize: 20, color: C.textLight, fontWeight: 300 }}>›</span>
                </div>
              </div>
              {processing ? (
                <div style={{ fontSize: 13, color: C.purple, padding: "8px 0" }}>🤖 AI 분석이 진행 중입니다...</div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
                    {checks.map((c, idx) => (
                      <label key={idx} onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: C.textMid, cursor: "pointer" }}>
                        <input type="checkbox" checked={c.done} onChange={() => toggleCheck(doc.doc_id, c.l, c.done)} style={{ accentColor: C.purple, width: 15, height: 15, cursor: "pointer" }} />
                        <span style={{ textDecoration: c.done ? "line-through" : "none", opacity: c.done ? 0.55 : 1 }}>{c.l}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ height: 5, background: C.track, borderRadius: 3, marginTop: 14 }}><div style={{ height: "100%", borderRadius: 3, background: C.purple, width: percentage+"%" }} /></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textLight, marginTop: 5 }}>
                    <span>서류 준비 현황</span><span style={{ color: C.purple, fontWeight: 600 }}>{doneCount} / {doc.total} 완료</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExpiredPage({ onNavTo, toast }) {
  const { docs: allDocs, loading, error, reload } = useDocuments();
  const [hidden, setHidden] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteSuccess, setShowDeleteSuccess] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 마감 지난 문서만
  const docs = allDocs.filter(d => {
    if (hidden.includes(d.doc_id)) return false;
    const dd = ddayInfo(d.deadlineDate);
    return dd.isPast;
  });

  const handleDeleteClick = (docId) => {
    setDeleteTarget(docId);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await deleteDocument(deleteTarget);
      setHidden(prev => [...prev, deleteTarget]); // 즉시 숨김
      setShowDeleteConfirm(false);
      setShowDeleteSuccess(true);
      setTimeout(() => setShowDeleteSuccess(false), 2000);
      reload?.(); // 서버 목록 갱신
    } catch (e) {
      toast("삭제 실패: " + (e.response?.data?.message || e.message));
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}><div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>마감된 문서</div><div style={{ fontSize: 14, color: C.textLight }}>마감이 지난 문서 목록입니다.</div></div>
      {loading && <Skeleton rows={3} />}
      {error && <div style={{ ...S.card, color: C.red }}>⚠️ {error}</div>}
      {!loading && !error && docs.length === 0 && (
        <EmptyState icon="🗂️" title="마감된 문서가 없습니다" desc="마감일이 지난 문서가 여기에 모입니다." />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {docs.map(doc => {
          const doneCount = doc.checks.filter(c => c.done).length;
          const totalChecks = doc.checks.length || 1;
          const allDone = doneCount === doc.checks.length && doc.checks.length > 0;

          return (
            <div key={doc.doc_id} style={{ ...S.card, opacity: 0.85 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: allDone ? "#F0FDF4" : "#FFE5E5", color: allDone ? C.green : C.red }}>
                  {allDone ? '완료' : '미완료'}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.textLight }}>{doc.deadlineDate || "마감일 미상"}</span>
                  <button onClick={() => handleDeleteClick(doc.doc_id)} style={{ ...S.btnOutline, fontSize: 11, padding: "5px 10px", color: C.red, borderColor: C.red }}>🗑️ 삭제</button>
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, margin: "10px 0 4px" }}>{doc.title}</div>
              <div style={{ fontSize: 12, color: C.textLight, marginBottom: 14 }}>📎 업로드: {doc.upload} · 마감: {doc.deadlineDate || "-"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {doc.checks.map((c, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: C.textMid }}>
                    <input type="checkbox" checked={c.done} disabled style={{ accentColor: C.purple, width: 15, height: 15, cursor: "not-allowed", opacity: 0.7 }} />
                    <span>{c.l}</span>
                  </div>
                ))}
              </div>
              <div style={{ height: 5, background: "#F0EEF8", borderRadius: 3, marginTop: 14 }}><div style={{ height: "100%", borderRadius: 3, background: C.purple, width: (doneCount/totalChecks*100)+"%" }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textLight, marginTop: 5 }}>
                <span>최종 준비 완료율</span>
                <span style={{ fontWeight: 600, color: allDone ? C.textMid : C.red }}>{doneCount} / {doc.checks.length} · {Math.round(doneCount/totalChecks*100)}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 삭제 확인 팝업 */}
      {showDeleteConfirm && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 14, padding: 28, textAlign: "center", maxWidth: 320, boxShadow: "0 20px 48px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>삭제하시겠습니까?</div>
            <div style={{ fontSize: 13, color: C.textLight, marginBottom: 24 }}>선택한 문서를 영구 삭제합니다 (복구 불가)</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={handleDeleteCancel} disabled={deleting} style={{ ...S.btnOutline, fontSize: 13 }}>아니오</button>
              <button onClick={handleDeleteConfirm} disabled={deleting} style={{ ...S.btnPrimary, fontSize: 13, opacity: deleting ? 0.6 : 1 }}>{deleting ? "삭제 중..." : "예"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 성공 팝업 */}
      {showDeleteSuccess && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: 14, padding: 28, textAlign: "center", maxWidth: 320, boxShadow: "0 20px 48px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>삭제되었습니다</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleDetailPage({ day, title, prevSub, onNavTo, toast }) {
  const [memo, setMemo] = useState("");
  const [checkState, setCheckState] = useState({}); // name -> bool (낙관적 오버라이드)
  const isMobile = useIsMobile();
  const { docs: serverDocs, loading } = useDocuments();

  // title로 실제 문서 매칭
  const matched = serverDocs.find(d => d.title === title || d.filename === title);
  const docId = matched?.doc_id;
  const memoKey = docId ? `docMemo_${docId}` : null;

  // 메모 로드 (doc_id 기준 — 문서·일정 상세가 같은 메모 공유)
  useEffect(() => {
    if (memoKey) setMemo(localStorage.getItem(memoKey) || "");
  }, [memoKey]);

  const data = matched ? (() => {
    const dd = ddayInfo(matched.deadlineDate);
    const urgent = dd.days !== null && dd.days <= 3;
    return {
      title: matched.title,
      deadline: matched.deadlineDate || "마감일 없음",
      dday: dd.text,
      summary: matched.summary || "요약 정보가 없습니다.",
      color: urgent ? C.red : C.purple,
      bg: urgent ? C.redBg : C.purpleBg,
    };
  })() : null;

  if (loading) return <Skeleton rows={2} />;
  if (!data) return (
    <div>
      <button onClick={() => onNavTo(prevSub || "sub-schedule")} style={{ ...S.btnOutline, fontSize: 12, marginBottom: 16 }}>← 돌아가기</button>
      <div style={{ ...S.card, textAlign: "center", color: C.textLight }}>일정을 찾을 수 없습니다.</div>
    </div>
  );

  // 체크리스트: 백엔드(matched.checks) 기준 + 낙관적 오버라이드 (OngoingPage와 동일 저장소)
  const mergedChecks = (matched.checks || []).map(c => ({
    name: c.l,
    done: c.l in checkState ? checkState[c.l] : c.done,
  }));
  const total = mergedChecks.length;
  const completedCount = mergedChecks.filter(c => c.done).length;

  const toggleCheck = async (name, current) => {
    const next = !current;
    setCheckState(s => ({ ...s, [name]: next })); // 즉시 반영
    try {
      const { data: res } = await updateChecklistItem(docId, name, next);
      if (!res.success) throw new Error(res.message || "저장 실패");
    } catch (e) {
      setCheckState(s => ({ ...s, [name]: current })); // 롤백
      toast("체크리스트 저장 실패: " + (e.response?.data?.message || e.message));
    }
  };

  const saveMemo = () => {
    if (memoKey) localStorage.setItem(memoKey, memo);
    toast("메모가 저장되었습니다 ✓");
  };

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{data.title}</div>
          <div style={{ fontSize: 14, color: C.textLight }}>마감: {data.deadline}</div>
        </div>
        <button onClick={() => onNavTo(prevSub || "sub-schedule")} style={{ ...S.btnOutline, fontSize: 12 }}>← 돌아가기</button>
      </div>

      {/* 디데이 배지 */}
      <div style={{ display: "inline-block", fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 20, background: data.bg, color: data.color, marginBottom: 20 }}>{data.dday}</div>

      {/* 내용 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* 왼쪽: 요약 */}
        <div style={{ ...S.card }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>📋 일정 요약</div>
          <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6 }}>{data.summary}</div>
        </div>

        {/* 오른쪽: 필요 서류 */}
        <div style={{ ...S.card }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>📄 필요 서류</div>
            <span style={{ fontSize: 11, color: C.textLight }}>체크 시 자동 저장</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {total === 0 && <div style={{ fontSize: 13, color: C.textLight }}>필요 서류 정보가 없습니다.</div>}
            {mergedChecks.map((c) => (
              <label key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c.name, c.done)} style={{ accentColor: data.color, width: 16, height: 16 }} />
                <span style={{ color: C.textMid, textDecoration: c.done ? "line-through" : "none" }}>{c.name}</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textLight }}>
            준비율: <span style={{ fontWeight: 600, color: data.color }}>{completedCount}/{total}</span>
          </div>
        </div>
      </div>

      {/* 메모 */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📝 메모</div>
          <button onClick={saveMemo} style={{ ...S.btnPrimary, fontSize: 12, padding: "6px 12px" }}>저장하기</button>
        </div>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="이 일정에 대한 메모를 작성하세요..."
          style={{
            width: "100%",
            minHeight: 120,
            padding: 12,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box"
          }}
        />
      </div>
    </div>
  );
}

function DocumentDetailPage({ data, prevSub, onNavTo, toast }) {
  const [memo, setMemo] = useState("");
  const [checkState, setCheckState] = useState({}); // name -> bool (낙관적 오버라이드)
  const isMobile = useIsMobile();
  const memoKey = data ? `docMemo_${data.doc_id}` : null;

  // 메모 로드 (doc_id 기준 — 이름 변경/충돌에 안전)
  useEffect(() => {
    if (memoKey) setMemo(localStorage.getItem(memoKey) || "");
  }, [memoKey]);

  if (!data) return <div>문서를 찾을 수 없습니다</div>;

  // 체크리스트는 백엔드(data.checks)를 기준으로 표시, checkState로 낙관적 오버라이드
  const mergedChecks = (data.checks || []).map(c => ({
    name: c.l,
    done: c.l in checkState ? checkState[c.l] : c.done,
  }));
  const total = mergedChecks.length;
  const completedCount = mergedChecks.filter(c => c.done).length;
  const statusColor = total > 0 && completedCount === total ? C.green : completedCount > 0 ? C.ongoing : C.red;
  const statusBg = statusColor === C.green ? C.greenBg : statusColor === C.red ? C.redBg : C.ongoingBg;

  const toggleCheck = async (name, current) => {
    const next = !current;
    setCheckState(s => ({ ...s, [name]: next })); // 즉시 반영
    try {
      const { data: res } = await updateChecklistItem(data.doc_id, name, next);
      if (!res.success) throw new Error(res.message || "저장 실패");
    } catch (e) {
      setCheckState(s => ({ ...s, [name]: current })); // 롤백
      toast("체크리스트 저장 실패: " + (e.response?.data?.message || e.message));
    }
  };

  const saveMemo = () => {
    if (memoKey) localStorage.setItem(memoKey, memo);
    toast("메모가 저장되었습니다 ✓");
  };

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{data.title}</div>
          <div style={{ fontSize: 14, color: C.textLight }}>마감: {data.deadline} · {data.ago}</div>
        </div>
        <button onClick={() => onNavTo(prevSub || "sub-home")} style={{ ...S.btnOutline, fontSize: 12 }}>← 돌아가기</button>
      </div>

      {/* 진행률 배지 */}
      <div style={{ display: "inline-block", fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 20, background: statusBg, color: statusColor, marginBottom: 20 }}>{completedCount}/{total} 완료</div>

      {/* 내용 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* 왼쪽: 요약 */}
        <div style={{ ...S.card }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>📋 문서 요약</div>
          <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, marginBottom: 14 }}>{data.summary}</div>
          <div style={{ fontSize: 12, color: C.textLight }}>📎 업로드: {data.upload}</div>
        </div>

        {/* 오른쪽: 필요 서류 */}
        <div style={{ ...S.card }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>📄 필요 서류</div>
            <span style={{ fontSize: 11, color: C.textLight }}>체크 시 자동 저장</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {total === 0 && <div style={{ fontSize: 13, color: C.textLight }}>필요 서류 정보가 없습니다.</div>}
            {mergedChecks.map((c) => (
              <label key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c.name, c.done)} style={{ accentColor: statusColor, width: 16, height: 16 }} />
                <span style={{ color: C.textMid, textDecoration: c.done ? "line-through" : "none" }}>{c.name}</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textLight }}>
            준비율: <span style={{ fontWeight: 600, color: statusColor }}>{completedCount}/{total}</span>
          </div>
        </div>
      </div>

      {/* 메모 */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📝 메모</div>
          <button onClick={saveMemo} style={{ ...S.btnPrimary, fontSize: 12, padding: "6px 12px" }}>저장하기</button>
        </div>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="이 문서에 대한 메모를 작성하세요..."
          style={{
            width: "100%",
            minHeight: 120,
            padding: 12,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box"
          }}
        />
      </div>
    </div>
  );
}

function Toggle({ defaultOn = false, checked, onChange }) {
  const controlled = onChange !== undefined;
  const [internal, setInternal] = useState(defaultOn);
  const on = controlled ? checked : internal;
  const handle = () => { if (controlled) onChange(); else setInternal(p => !p); };
  return (
    <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer", display: "inline-block" }}>
      <input type="checkbox" checked={on} onChange={handle} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: 24, background: on ? C.purple : "#DDD", transition: "background .2s" }}>
        <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "white", top: 3, left: on ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
      </span>
    </label>
  );
}

const DEFAULT_NOTIF = { deadline: true, incomplete: true, analysis: true, mail: true, weekly: false };

function ProfilePage({ toast, onLogout }) {
  const user = getUser();
  const isMobile = useIsMobile();
  const userId = localStorage.getItem("user_id") || user.email;
  const isEmailUser = (localStorage.getItem("user_id") || "").includes("@"); // 이메일 가입자는 user_id가 이메일(@ 포함), 구글 로그인은 숫자 sub
  const [settingsTab, setSettingsTab] = useState("profile");
  const [profileImage, setProfileImage] = useState(null);
  const [tempImage, setTempImage] = useState(null);
  const [showImageEditor, setShowImageEditor] = useState(false);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [imageScale, setImageScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const fileInputRef = useRef(null);
  const tabs = [["profile","👤 프로필"],["notifications","🔔 알림 설정"],["security","🔒 보안"],["calendar","📅 캘린더 연동"]];

  // 프로필 폼 (이메일=user_id는 변경 불가)
  const [name, setName] = useState(user.name || "");
  const [affiliation, setAffiliation] = useState(localStorage.getItem("user_affiliation") || "");
  const [savingProfile, setSavingProfile] = useState(false);
  // 비밀번호 변경 (이메일 가입자 전용)
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  // 알림 설정
  const [notif, setNotif] = useState(() => {
    try { return { ...DEFAULT_NOTIF, ...(JSON.parse(localStorage.getItem("notif_settings") || "{}")) }; }
    catch { return DEFAULT_NOTIF; }
  });

  const saveProfile = async () => {
    if (!name.trim()) { toast("이름을 입력해주세요"); return; }
    setSavingProfile(true);
    try {
      const { data } = await updateProfile(userId, name.trim(), affiliation.trim());
      if (!data.success) throw new Error(data.message);
      localStorage.setItem("user_name", name.trim());
      localStorage.setItem("user_affiliation", affiliation.trim());
      toast("프로필이 저장되었습니다 ✓");
    } catch (e) { toast(e.response?.data?.message || e.message || "저장에 실패했어요"); }
    finally { setSavingProfile(false); }
  };

  const savePassword = async () => {
    if (!curPw || !newPw) { toast("비밀번호를 입력해주세요"); return; }
    if (newPw !== confirmPw) { toast("새 비밀번호가 일치하지 않습니다"); return; }
    if (newPw.length < 8) { toast("새 비밀번호는 8자 이상이어야 합니다"); return; }
    setSavingPw(true);
    try {
      const { data } = await changePassword(userId, curPw, newPw);
      if (!data.success) throw new Error(data.message);
      toast("비밀번호가 변경되었습니다 ✓");
      setCurPw(""); setNewPw(""); setConfirmPw("");
    } catch (e) { toast(e.response?.data?.message || e.message || "변경에 실패했어요"); }
    finally { setSavingPw(false); }
  };

  const toggleNotif = async (key) => {
    const next = { ...notif, [key]: !notif[key] };
    setNotif(next);
    localStorage.setItem("notif_settings", JSON.stringify(next));
    try { await updateNotifSettings(userId, next); } catch (e) { /* 로컬엔 저장됨 — 무음 처리 */ }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("정말 탈퇴하시겠어요? 모든 문서가 삭제되며 복구할 수 없습니다.")) return;
    try {
      const { data } = await deleteAccount(userId);
      if (!data.success) throw new Error(data.message);
      localStorage.clear();
      toast("회원 탈퇴가 완료되었습니다");
      onLogout?.();
    } catch (e) { toast(e.response?.data?.message || e.message || "탈퇴에 실패했어요"); }
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file && ["image/png", "image/jpeg"].includes(file.type)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setTempImage(event.target?.result);
        setShowImageEditor(true);
        setImagePosition({ x: 0, y: 0 });
        setImageScale(1);
      };
      reader.readAsDataURL(file);
    }
    // 같은 파일을 다시 선택할 수 있도록 input 초기화
    e.target.value = '';
  };

  const handleImageConfirm = () => {
    // Canvas로 원형 이미지 생성 (미리보기와 동일한 계산)
    try {
      const editorSize = 380;
      const previewSize = 140;

      // 이미지 로드
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = function() {
        try {
          const scaledWidth = img.width * imageScale;
          const scaledHeight = img.height * imageScale;
          const editSize = 400; // 모달의 편집 영역 크기
          const centerX = editSize / 2;
          const centerY = editSize / 2;

          // 1단계: 임시 Canvas를 편집 영역 크기로 생성
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = editSize;
          tempCanvas.height = editSize;
          const tempCtx = tempCanvas.getContext('2d');
          if (!tempCtx) throw new Error('Canvas context 실패');

          // 배경 흰색
          tempCtx.fillStyle = 'white';
          tempCtx.fillRect(0, 0, editSize, editSize);

          // 2단계: 편집 화면과 동일하게 이미지 배치 (원본 비율 유지)
          // 편집 화면: width: 100% * imageScale = 400 * imageScale, height: auto
          const displayWidth = 400 * imageScale;
          const displayHeight = displayWidth * (img.height / img.width); // 원본 비율 유지

          tempCtx.drawImage(
            img,
            centerX + imagePosition.x - displayWidth / 2,
            centerY + imagePosition.y - displayHeight / 2,
            displayWidth,
            displayHeight
          );

          // 3단계: 최종 Canvas 생성 (140x140 원형)
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = previewSize;
          finalCanvas.height = previewSize;
          const finalCtx = finalCanvas.getContext('2d');

          // 4단계: 원형 마스크 생성
          finalCtx.beginPath();
          finalCtx.arc(previewSize / 2, previewSize / 2, previewSize / 2, 0, Math.PI * 2);
          finalCtx.clip();

          // 5단계: 배경 흰색
          finalCtx.fillStyle = 'white';
          finalCtx.fillRect(0, 0, previewSize, previewSize);

          // 6단계: 임시 Canvas의 원형 가이드 부분을 최종 Canvas로 복사
          // 편집 화면의 원형 프레임과 정확히 일치하도록
          const frameSize = 200; // 편집 화면의 원형 프레임 크기
          const frameStartX = (editSize - frameSize) / 2; // (400 - 200) / 2 = 100
          const frameStartY = (editSize - frameSize) / 2; // 100

          finalCtx.drawImage(
            tempCanvas,
            frameStartX,
            frameStartY,
            frameSize,
            frameSize,
            0,
            0,
            previewSize,
            previewSize
          );

          const result = finalCanvas.toDataURL('image/png');
          setProfileImage(result);
          localStorage.setItem('profileImage', result);
          // Header 업데이트를 위한 custom 이벤트 발생
          window.dispatchEvent(new CustomEvent('profileImageUpdated', { detail: result }));
          setShowImageEditor(false);
          setTempImage(null);
        } catch (e) {
          console.error('이미지 그리기 실패:', e);
          setProfileImage(tempImage);
          setShowImageEditor(false);
          setTempImage(null);
        }
      };

      img.onerror = function() {
        console.error('이미지 로드 실패');
        setProfileImage(tempImage);
        setShowImageEditor(false);
        setTempImage(null);
      };

      img.src = tempImage;
    } catch (e) {
      console.error('Canvas 오류:', e);
      setProfileImage(tempImage);
      setShowImageEditor(false);
      setTempImage(null);
    }
  };

  const handleImageCancel = () => {
    setShowImageEditor(false);
    setTempImage(null);
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    let newX = e.clientX - dragStartRef.current.x;
    let newY = e.clientY - dragStartRef.current.y;

    // 이미지 자유로운 이동 (중앙 기준)
    // 사용자가 충분히 조정할 수 있도록 여유 있는 범위 설정
    const minOffsetX = -300;
    const maxOffsetX = 300;
    const minOffsetY = -300;
    const maxOffsetY = 300;

    newX = Math.max(minOffsetX, Math.min(maxOffsetX, newX));
    newY = Math.max(minOffsetY, Math.min(maxOffsetY, newY));

    setImagePosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>내 정보</div><div style={{ fontSize: 14, color: C.textLight }}>계정 정보와 알림 설정을 관리하세요.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr", gap: 20, alignItems: "start" }}>
        <div style={{ background: "white", borderRadius: 14, overflow: "hidden" }}>
          {tabs.map(([id, label]) => (
            <div key={id} onClick={() => setSettingsTab(id)} style={{ padding: "13px 18px", fontSize: 13, fontWeight: settingsTab===id ? 600 : 500, cursor: "pointer", borderLeft: `3px solid ${settingsTab===id ? C.purple : "transparent"}`, color: settingsTab===id ? C.purple : C.textMid, background: settingsTab===id ? C.purpleBg : "transparent" }}>{label}</div>
          ))}
        </div>
        <div style={{ background: "white", borderRadius: 14, padding: 28 }}>
          {settingsTab === "profile" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24 }}>
                <div style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  background: profileImage ? "white" : `linear-gradient(135deg,${C.purple},${C.purpleLight})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontSize: 26,
                  fontWeight: 700,
                  overflow: "hidden",
                  position: "relative"
                }}>
                  {profileImage ? (
                    <img
                      src={profileImage}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        borderRadius: "50%"
                      }}
                    />
                  ) : (
                    (user.name || "사")[0]
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{user.name}</div>
                  <div style={{ fontSize: 12, color: C.textLight, marginBottom: 10 }}>{user.email}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => fileInputRef.current?.click()} style={{ padding: "7px 14px", fontSize: 12, borderRadius: 8, fontWeight: 600, cursor: "pointer", background: C.purpleBg, color: C.purple, border: "none", fontFamily: "inherit" }}>사진 변경</button>
                    <button onClick={() => { setProfileImage(null); localStorage.removeItem("profileImage"); window.dispatchEvent(new CustomEvent("profileImageUpdated", { detail: null })); }} style={{ padding: "7px 14px", fontSize: 12, borderRadius: 8, fontWeight: 600, cursor: "pointer", background: C.bg, color: C.textMid, border: "none", fontFamily: "inherit" }}>삭제</button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={handleImageChange} style={{ display: "none" }} />
                </div>
              </div>
              <hr style={{ border: "none", borderTop: `1px solid ${C.purpleBorder}`, margin: "0 0 24px" }} />
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>기본 정보</div>
              <div style={{ marginBottom: 16 }}>
                <label style={S.label}>이름</label>
                <input style={S.formInput} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={S.label}>이메일</label>
                <input style={{ ...S.formInput, background: C.bg, color: C.textLight, cursor: "not-allowed" }} type="email" value={user.email} readOnly title="이메일은 변경할 수 없습니다" />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={S.label}>소속</label>
                <input style={S.formInput} type="text" value={affiliation} onChange={(e) => setAffiliation(e.target.value)} placeholder="학교 / 회사 이름 (선택)" />
              </div>
              <button onClick={saveProfile} disabled={savingProfile} style={{ ...S.btnPrimary, opacity: savingProfile ? 0.6 : 1 }}>{savingProfile ? "저장 중..." : "프로필 저장"}</button>
            </div>
          )}
          {settingsTab === "notifications" && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>📱 푸시 알림</div>
              {[["마감 임박 알림","마감 7일·3일·1일 전 알림","deadline"],["서류 미완료 리마인더","미준비 서류가 있을 때 알림","incomplete"],["문서 분석 완료 알림","업로드 문서 분석이 끝나면 알림","analysis"]].map(([lbl,sub,key]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.purpleBorder}` }}>
                  <div><div style={{ fontSize: 13, fontWeight: 500 }}>{lbl}</div><div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{sub}</div></div>
                  <Toggle checked={notif[key]} onChange={() => toggleNotif(key)} />
                </div>
              ))}
              <div style={{ fontSize: 15, fontWeight: 700, margin: "24px 0 16px" }}>📧 메일 알림</div>
              {[["메일 알림 받기","이메일로 마감 일정 알림 수신","mail"],["주간 요약 메일","매주 월요일 이번 주 마감 일정 요약","weekly"]].map(([lbl,sub,key]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.purpleBorder}` }}>
                  <div><div style={{ fontSize: 13, fontWeight: 500 }}>{lbl}</div><div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{sub}</div></div>
                  <Toggle checked={notif[key]} onChange={() => toggleNotif(key)} />
                </div>
              ))}
              <div style={{ marginTop: 16, fontSize: 12, color: C.textLight }}>변경 시 자동 저장됩니다 · 수신 이메일: {user.email || "-"}</div>
            </div>
          )}
          {settingsTab === "security" && (
            <div>
              {isEmailUser ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>비밀번호 변경</div>
                  <div style={{ marginBottom: 16 }}><label style={S.label}>현재 비밀번호</label><input style={S.formInput} type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="현재 비밀번호" /></div>
                  <div style={{ marginBottom: 16 }}><label style={S.label}>새 비밀번호</label><input style={S.formInput} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 (8자 이상)" /></div>
                  <div style={{ marginBottom: 16 }}><label style={S.label}>새 비밀번호 확인</label><input style={S.formInput} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="새 비밀번호 재입력" /></div>
                  <button onClick={savePassword} disabled={savingPw} style={{ ...S.btnPrimary, opacity: savingPw ? 0.6 : 1 }}>{savingPw ? "변경 중..." : "비밀번호 변경"}</button>
                </>
              ) : (
                <div style={{ fontSize: 13, color: C.textMid, padding: "8px 0 16px", lineHeight: 1.6 }}>Google 로그인 계정은 별도 비밀번호가 없습니다. 비밀번호는 Google 계정에서 관리됩니다.</div>
              )}
              <hr style={{ border: "none", borderTop: `1px solid ${C.purpleBorder}`, margin: "24px 0" }} />
              <div style={{ fontSize: 13, color: C.textLight, marginBottom: 10 }}>탈퇴 시 업로드한 모든 문서가 함께 삭제되며 복구할 수 없습니다.</div>
              <button onClick={handleDeleteAccount} style={{ ...S.btnOutline, color: C.red, borderColor: C.red }}>회원 탈퇴</button>
            </div>
          )}
          {settingsTab === "calendar" && (() => {
            const calConnected = !!localStorage.getItem("user_token");
            return (
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Google 캘린더 연동</div>
                {calConnected ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: C.greenBg, borderRadius: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 20 }}>✅</span>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>연동 완료</div><div style={{ fontSize: 12, color: C.textLight }}>{user.email || "Google 계정"}</div></div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: C.bg, borderRadius: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 20 }}>📅</span>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>미연동</div><div style={{ fontSize: 12, color: C.textLight }}>Google 로그인 시 캘린더가 자동 연결됩니다.</div></div>
                  </div>
                )}
                <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, padding: "8px 0" }}>
                  · 문서 분석이 완료되면 일정이 Google 캘린더에 <b>자동 등록</b>됩니다.<br />
                  · 각 일정에 마감 <b>D-7 · D-3 · D-1 리마인더</b>가 함께 설정됩니다.<br />
                  · 분석 결과 화면에서 <b>"캘린더에 다시 등록"</b>으로 재등록할 수 있습니다.
                </div>
                {calConnected && (
                  <button onClick={() => { localStorage.removeItem("user_token"); window.location.reload(); }} style={{ ...S.btnOutline, marginTop: 16, color: C.red, borderColor: C.red }}>캘린더 연결 해제</button>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* 사진 편집 모달 - 인스타그램 스타일 */}
      {showImageEditor && tempImage && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 1001 }} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          {/* 헤더 */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", background: "rgba(0,0,0,0.7)", color: "white" }}>
            <button onClick={handleImageCancel} style={{ background: "none", border: "none", color: "white", fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
            <div style={{ fontSize: 16, fontWeight: 700 }}>프로필 사진 편집</div>
            <button onClick={handleImageConfirm} style={{ background: "none", border: "none", color: C.purple, fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>완료</button>
          </div>

          {/* 편집 영역 */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginTop: 60, marginBottom: 120 }}>
            <div
              style={{
                position: "relative",
                width: 400,
                height: 400,
                overflow: "hidden",
                background: "#1a1a1a",
                cursor: isDragging ? "grabbing" : "grab"
              }}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {/* 이미지 */}
              <img
                src={tempImage}
                draggable={false}
                onMouseDown={handleMouseDown}
                style={{
                  width: `${100 * imageScale}%`,
                  height: "auto",
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: `translate(calc(-50% + ${imagePosition.x}px), calc(-50% + ${imagePosition.y}px))`,
                  cursor: isDragging ? "grabbing" : "grab",
                  userSelect: "none"
                }}
              />

              {/* 원형 가이드 (중앙) */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 200,
                  height: 200,
                  borderRadius: "50%",
                  border: `3px solid ${C.purple}`,
                  pointerEvents: "none",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)"
                }}
              />
            </div>
          </div>

          {/* 슬라이더 */}
          <div style={{ position: "absolute", bottom: 100, width: "80%", maxWidth: 400, padding: "0 20px", color: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12 }}>-</span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={imageScale}
                onChange={(e) => setImageScale(parseFloat(e.target.value))}
                style={{ flex: 1, cursor: "pointer" }}
              />
              <span style={{ fontSize: 12 }}>+</span>
              <span style={{ fontSize: 12, minWidth: 30, textAlign: "right" }}>{Math.round(imageScale * 100)}%</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Main App ──
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(params.get("page") || "login"); // "signup" | "login" | "app"
  const [sub, setSub] = useState(params.get("sub") || "sub-home");
  const [prevSub, setPrevSub] = useState("sub-home");
  const [scheduleDetailDay, setScheduleDetailDay] = useState(null);
  const [scheduleDetailTitle, setScheduleDetailTitle] = useState(null);
  const [docDetailData, setDocDetailData] = useState(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(typeof window !== "undefined" && window.innerWidth >= 768);
  const { msg, show, toast } = useToast();

  const titleMap = { "sub-home":"대시보드","sub-upload":"문서 업로드","sub-schedule":"일정 관리","sub-ongoing":"진행 중인 문서","sub-expired":"마감된 문서","sub-profile":"내 정보", "schedule-detail":"일정 상세", "doc-detail":"문서 상세" };

  const handleLogin = (m) => { setPage("app"); setSub("sub-home"); toast(m); };
  const handleLogout = () => {
    // 세션·사용자 데이터 정리 (다음 사용자에게 이전 정보가 남지 않도록)
    localStorage.clear();
    window.dispatchEvent(new CustomEvent("profileImageUpdated", { detail: null }));
    setPage("login");
    toast("로그아웃됐어요");
  };
  const navTo = (s, detailDay, data) => { if(s === "schedule-detail" || s === "doc-detail") setPrevSub(sub); setSub(s); if(detailDay) { if(typeof detailDay === 'number') setScheduleDetailDay(detailDay); else setScheduleDetailTitle(detailDay); } if(data) setDocDetailData(data); if(window.innerWidth < 768) setSidebarOpen(false); };

  // 히스토리 관리
  useEffect(() => {
    window.history.pushState({ sub, scheduleDetailDay, scheduleDetailTitle, docDetailData }, null, '');

    const handlePopState = (e) => {
      if (e.state) {
        setSub(e.state.sub || "sub-home");
        if (e.state.scheduleDetailDay) setScheduleDetailDay(e.state.scheduleDetailDay);
        if (e.state.scheduleDetailTitle) setScheduleDetailTitle(e.state.scheduleDetailTitle);
        if (e.state.docDetailData) setDocDetailData(e.state.docDetailData);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [sub, scheduleDetailDay, scheduleDetailTitle, docDetailData]);

  if (page === "signup") return <><SignupPage onLogin={handleLogin} goLogin={() => setPage("login")} toast={toast} /><ToastEl msg={msg} show={show} /></>;
  if (page === "login") return <><LoginPage onLogin={handleLogin} goSignup={() => setPage("signup")} goForgotPassword={() => setPage("forgot-password")} toast={toast} /><ToastEl msg={msg} show={show} /></>;
  if (page === "forgot-password") return <><ForgotPasswordPage toast={toast} goLogin={() => setPage("login")} /><ToastEl msg={msg} show={show} /></>;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{"@keyframes lbpulse{0%,100%{opacity:1}50%{opacity:.45}} :focus-visible{outline:2px solid #6B4FE8;outline-offset:2px;border-radius:6px}"}</style>
      <Header isLoggedIn={true} onLogout={handleLogout} onLogin={() => setPage("login")} onSignup={() => setPage("signup")} onNavTo={navTo} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div style={{ display: "flex", paddingTop: 58, minHeight: "calc(100vh - 58px)", minWidth: isMobile ? "auto" : 1024 }}>
        <Sidebar currentSub={sub} onNavTo={navTo} sidebarOpen={sidebarOpen} />
        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", top: 58, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }} />
        )}
        <main style={{ marginLeft: (!isMobile && sidebarOpen) ? 200 : 0, flex: 1, minWidth: 0, padding: isMobile ? "20px 16px 32px" : "28px 28px 40px 48px", transition: "marginLeft 0.35s cubic-bezier(0.4, 0, 0.2, 1)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{titleMap[sub]}</div>
          {sub === "sub-home" && <Dashboard onNavTo={navTo} />}
          {sub === "sub-upload" && <UploadPage onNavTo={navTo} />}
          {sub === "sub-schedule" && <SchedulePage onNavTo={navTo} />}
          {sub === "schedule-detail" && <ScheduleDetailPage day={scheduleDetailDay} title={scheduleDetailTitle} prevSub={prevSub} onNavTo={navTo} toast={toast} />}
          {sub === "sub-ongoing" && <OngoingPage onNavTo={navTo} toast={toast} />}
          {sub === "sub-expired" && <ExpiredPage onNavTo={navTo} toast={toast} />}
          {sub === "doc-detail" && <DocumentDetailPage data={docDetailData} prevSub={prevSub} onNavTo={navTo} toast={toast} />}
          {sub === "sub-profile" && <ProfilePage toast={toast} onLogout={handleLogout} />}
        </main>
      </div>
      <ToastEl msg={msg} show={show} />
    </div>
  );
}

function ToastEl({ msg, show }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 999, background: "#1A1025", color: "white", padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", transform: show ? "none" : "translateY(80px)", opacity: show ? 1 : 0, transition: "all .35s cubic-bezier(0.34,1.56,0.64,1)", pointerEvents: "none" }}>
      {msg}
    </div>
  );
}
// Stable version
