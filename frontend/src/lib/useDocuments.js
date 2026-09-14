import { useState, useEffect } from 'react';
import { listDocuments, toScreenDoc } from './api';
import { getUser } from './auth';

// 사용자 문서 목록 훅: { docs, loading, error, reload }
export function useDocuments() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    const userId = getUser().id || "anonymous";
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
