// LittleBoss 백엔드 API 클라이언트
import axios from "axios";
import { useState, useEffect } from "react";

const API_URL = import.meta.env.VITE_API_URL;

const api = axios.create({ baseURL: API_URL, timeout: 30000 });

// 헬스 체크
export const checkHealth = () => api.get("/health");

// 파일 업로드 → { success, doc_id, status, ... }
export const uploadFile = (file, userId) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("user_id", userId || "anonymous");
  return api.post("/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// 문서 상태/분석결과 조회 (폴링용)
export const getDocument = (docId) => api.get(`/documents/${docId}`);

// 문서 삭제
export const deleteDocument = (docId) => api.delete(`/documents/${docId}`);

// 사용자 문서 목록
export const listDocuments = (userId) =>
  api.get("/documents", { params: { user_id: userId } });

// 캘린더 등록 (Google access_token 필요)
export const registerCalendar = (docId, userToken) =>
  api.post(`/calendar/${docId}`, { user_token: userToken });

// 체크리스트
export const getChecklist = (docId) => api.get(`/checklist/${docId}`);
export const updateChecklistItem = (docId, name, completed) =>
  api.patch(`/checklist/${docId}`, { name, completed });

// 이메일/비밀번호 인증
export const signup = (name, email, password) =>
  api.post("/auth/signup", { name, email, password });
export const emailLogin = (email, password) =>
  api.post("/auth/login", { email, password });

// 프로필/계정 관리
export const updateProfile = (userId, name, affiliation) =>
  api.patch("/auth/profile", { user_id: userId, name, affiliation });
export const changePassword = (userId, currentPassword, newPassword) =>
  api.post("/auth/change-password", { user_id: userId, current_password: currentPassword, new_password: newPassword });
export const updateNotifSettings = (userId, settings) =>
  api.post("/auth/notif-settings", { user_id: userId, settings });
export const deleteAccount = (userId) =>
  api.delete("/auth/account", { params: { user_id: userId } });

// 비밀번호 찾기 (이메일 인증 코드)
export const requestReset = (email) => api.post("/auth/reset/request", { email });
export const verifyReset = (email, code) => api.post("/auth/reset/verify", { email, code });
export const confirmReset = (email, code, newPassword) =>
  api.post("/auth/reset/confirm", { email, code, new_password: newPassword });

// 업로드 후 분석 완료까지 폴링 (status: done | error)
export async function pollUntilDone(docId, { interval = 3000, maxTries = 100, onTick } = {}) {
  for (let i = 0; i < maxTries; i++) {
    const { data } = await getDocument(docId);
    const doc = data.document;
    if (!doc) throw new Error("문서를 찾을 수 없습니다");
    onTick?.(doc.status, i);
    if (doc.status === "done") return doc;
    if (doc.status === "error") {
      throw new Error(doc.error_message || "분석 실패");
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("분석 시간 초과 (5분)");
}

// ── 문서 데이터 변환 헬퍼 ──────────────────────────────

// D-day 계산
export function ddayInfo(dateStr) {
  if (!dateStr) return { text: "마감일 없음", isPast: false, days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (isNaN(days)) return { text: "마감일 미정", isPast: false, days: null };
  if (days < 0) return { text: `${-days}일 전`, isPast: true, days };
  if (days === 0) return { text: "D-Day", isPast: false, days };
  return { text: `D-${days}`, isPast: false, days };
}

// 백엔드 문서 → 화면용 공통 형태
export function toScreenDoc(doc) {
  const a = doc.analysis || {};
  const firstDeadline = (a.deadlines && a.deadlines[0]) || null;
  const reqDocs = a.required_documents || [];
  const checklist =
    (doc.checklist && doc.checklist.length ? doc.checklist : null) ||
    reqDocs.map((d) => ({ name: d.name, completed: !!d.have }));
  return {
    doc_id: doc.doc_id,
    title: a.document_type || doc.filename || "문서",
    filename: doc.filename || "",
    summary: a.summary || "",
    upload: (doc.created_at || "").slice(0, 10).replace(/-/g, "."),
    status: doc.status,
    deadlineDate: firstDeadline?.date || null,
    deadlineDesc: firstDeadline?.description || "",
    urgency: firstDeadline?.urgency || "normal",
    deadlines: a.deadlines || [],
    calendar_events: a.calendar_events || [],
    checks: checklist.map((c) => ({ l: c.name, done: !!c.completed })),
    total: checklist.length,
  };
}

// 문서들 → 개별 마감 이벤트 목록 (문서당 deadlines 전부 전개)
// title=표시용(마감 설명), navTitle=상세 이동용(문서종류 — ScheduleDetailPage가 title로 매칭)
export function deadlineEvents(screenDocs) {
  const out = [];
  (screenDocs || []).forEach((d) => {
    (d.deadlines || []).forEach((dl) => {
      if (!dl || !dl.date) return;
      out.push({
        doc_id: d.doc_id,
        navTitle: d.title,
        title: dl.description || d.title,
        date: dl.date,
        urgency: dl.urgency || "normal",
        checks: d.checks || [],
        total: d.total || 0,
      });
    });
  });
  return out;
}

// 특정 연/월의 일별 마감 이벤트 맵: { 22: { status, title, navTitle, doc_id } }
// status: completed(전체 완료) | ongoing(진행중) | incomplete(마감지남·미완)
export function deadlinesForMonth(screenDocs, year, month1to12) {
  const map = {};
  const rank = { ongoing: 3, incomplete: 2, completed: 1 };
  deadlineEvents(screenDocs).forEach((e) => {
    const dt = new Date(e.date);
    if (isNaN(dt)) return;
    if (dt.getFullYear() !== year || dt.getMonth() + 1 !== month1to12) return;
    const day = dt.getDate();
    const doneAll = e.total > 0 && e.checks.filter((c) => c.done).length === e.total;
    const past = ddayInfo(e.date).isPast;
    const status = doneAll ? "completed" : past ? "incomplete" : "ongoing";
    // 같은 날 여러 건이면 진행중 > 미완 > 완료 우선
    if (!map[day] || rank[status] > rank[map[day].status]) {
      map[day] = { status, title: e.title, navTitle: e.navTitle, doc_id: e.doc_id };
    }
  });
  return map;
}

// 사용자 문서 목록 훅: { docs, loading, error, reload }
export function useDocuments() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    const userId = localStorage.getItem("user_id") || "anonymous";
    setLoading(true);
    setError("");
    try {
      const { data } = await listDocuments(userId);
      const mapped = (data.documents || []).map(toScreenDoc);
      setDocs(mapped);
    } catch (e) {
      setError(e.response?.data?.message || e.message || "문서 조회 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { docs, loading, error, reload: load };
}

export default api;
