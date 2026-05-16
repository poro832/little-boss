// LittleBoss 백엔드 API 클라이언트
import axios from "axios";

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

export default api;
