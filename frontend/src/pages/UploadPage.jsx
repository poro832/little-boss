import { useState, useRef, useEffect } from 'react';
import { useDocuments } from '../lib/useDocuments';
import { getUser, getCalendarToken, clearCalendarToken } from '../lib/auth';
import { uploadFile, pollUntilDone, registerCalendar } from '../lib/api';
import Card from '../components/Card';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import ProgressBar from '../components/ProgressBar';
import { Upload, FileText, Calendar, ListCheck, CheckCircle, Sparkle } from '../icons';

// 우측 "분석 완료 문서" 패널 한 줄. 이 화면에서만 쓰여서 공용 컴포넌트로 빼지 않는다.
function FileRow({ file, onNavTo }) {
  const clickable = !!file.scheduleTitle;
  return (
    <button
      type="button"
      className="upload-file-row"
      onClick={() => clickable && onNavTo('schedule-detail', file.scheduleTitle)}
      disabled={!clickable}
    >
      <FileText size={20} />
      <div className="upload-file-row-body">
        <div className="upload-file-row-name">{file.name}</div>
        <div className="t-caption">{file.date}</div>
      </div>
    </button>
  );
}

export default function UploadPage({ onNavTo }) {
  const [queue, setQueue] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [uploadConfirm, setUploadConfirm] = useState(false);
  const [fileToUpload, setFileToUpload] = useState(null);
  const [checkedFiles, setCheckedFiles] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [calMsg, setCalMsg] = useState(null); // { text, tone: 'success' | 'info' }
  const fileInputRef = useRef(null);
  const { docs: serverDocs } = useDocuments();
  const completedFiles = serverDocs
    .filter((d) => d.status === 'done')
    .map((d) => ({ id: d.doc_id, name: d.filename || d.title, date: d.upload, scheduleTitle: d.title }));

  const addFiles = async (files) => {
    const userId = getUser().id || 'anonymous';
    const list = [...files];
    const items = list.map((f) => ({
      name: f.name,
      size: f.size > 1048576 ? (f.size / 1048576).toFixed(1) + 'MB' : (f.size / 1024).toFixed(0) + 'KB',
      progress: 0,
      id: Date.now() + f.name,
    }));
    setQueue((q) => [...q, ...items]);
    setErrMsg('');

    for (let idx = 0; idx < list.length; idx++) {
      const file = list[idx];
      const item = items[idx];
      const setP = (p, extra = {}) =>
        setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, progress: p, ...extra } : i)));
      try {
        setP(25);
        const { data } = await uploadFile(file, userId);
        if (!data.success) throw new Error(data.message || '업로드 실패');
        setP(55);
        setAnalyzing(true);
        const doc = await pollUntilDone(data.doc_id, {
          onTick: () => setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, progress: Math.min((i.progress || 55) + 4, 95) } : i))),
        });
        setP(100);
        setAnalysis({ ...(doc.analysis || {}), doc_id: data.doc_id, filename: file.name });

        // 분석 완료 → Google 로그인 상태면 캘린더 자동 등록
        const a = doc.analysis || {};
        const token = getCalendarToken();
        const evCount = (a.calendar_events || []).length;
        if (evCount > 0 && token) {
          setCalMsg({ text: '캘린더에 일정 등록 중...', tone: 'success' });
          try {
            const { data: cal } = await registerCalendar(data.doc_id, token);
            const results = cal.created_events || [];
            const allFailed = results.length > 0 && results.every((r) => r.status !== 'created');
            if (allFailed) {
              // 전부 실패 → 토큰 만료로 간주하고 파일 처리 시점에서만 정리(lazy).
              // 만료(401) 외 사유(400/429 등)와 구별 불가하나, 오탐은 드물고 재연결로 복구 가능.
              clearCalendarToken();
              setCalMsg({ text: '캘린더 연결이 만료됐어요. 내 정보 > 연결된 서비스에서 다시 연결해 주세요.', tone: 'info' });
            } else {
              setCalMsg(
                cal.success
                  ? { text: cal.message, tone: 'success' }
                  : { text: `캘린더 등록 실패: ${cal.message}`, tone: 'info' }
              );
            }
          } catch (er) {
            setCalMsg({ text: '캘린더 자동 등록 실패: ' + (er.response?.data?.message || er.message), tone: 'info' });
          }
        } else if (evCount > 0 && !token) {
          setCalMsg({ text: '설정에서 Google 캘린더를 연결하면 일정이 자동 등록됩니다.', tone: 'info' });
        }
      } catch (e) {
        setErrMsg(`${file.name}: ${e.message || '처리 실패'}`);
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
    if (uploadConfirm && queue.length > 0 && queue.every((f) => f.progress === 100)) {
      const t = setTimeout(() => {
        setUploadConfirm(false);
        setFileToUpload(null);
      }, 800);
      return () => clearTimeout(t);
    }
  }, [queue, uploadConfirm]);

  const resetQueue = () => {
    setQueue([]);
    setAnalysis(null);
    setErrMsg('');
    setCalMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      <div className="upload-head">
        <div className="t-body">분석할 문서를 업로드하면 AI가 서류·마감일을 자동 추출합니다.</div>
      </div>

      <div className="upload-grid">
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFileSelect(e.dataTransfer.files); }}
            className={`upload-dropzone${dragging ? ' upload-dropzone-active' : ''}`}
          >
            <div className="upload-dropzone-icon"><Upload size={40} /></div>
            <div className="upload-dropzone-title">여기에 파일을 드래그 &amp; 드롭하세요</div>
            <div className="upload-dropzone-desc">
              또는 아래 버튼으로 파일을 선택하세요<br />PDF · DOCX · HWPX · 이미지 · TXT 지원 · 최대 20MB
            </div>
            <div className="upload-dropzone-actions">
              <Button variant="primary" icon={Upload} onClick={() => fileInputRef.current?.click()}>
                파일 선택
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.hwpx,.txt,.md,.csv,.jpg,.jpeg,.png,.gif,.webp,.tiff,.tif"
                className="upload-input-hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
            </div>
            <div className="upload-dropzone-hint">지원 형식: PDF · DOCX · HWPX · JPG · PNG · TXT (HWP/DOC 구버전은 PDF 변환 권장)</div>
          </div>

          <div className="upload-stack">
            {queue.map((f) => (
              <div key={f.id} className="upload-queue-item">
                <FileText size={22} />
                <div className="upload-queue-item-body">
                  <div className="upload-queue-item-name">{f.name}</div>
                  <div className="t-caption">{f.size}</div>
                  <ProgressBar value={f.progress} total={100} />
                </div>
                <input
                  type="checkbox"
                  checked={checkedFiles[f.id] || false}
                  onChange={(e) => setCheckedFiles((prev) => ({ ...prev, [f.id]: e.target.checked }))}
                  className="upload-queue-item-check"
                />
              </div>
            ))}
            {queue.length > 0 && (
              <div className="upload-queue-actions">
                <Button variant="outline" size="sm" onClick={resetQueue}>초기화</Button>
              </div>
            )}
            {analyzing && (
              <div className="upload-banner upload-banner-info">
                <Sparkle size={16} /> AI가 문서를 분석하고 있습니다... (15~30초 소요)
              </div>
            )}
            {errMsg && <div className="upload-banner upload-banner-error">{errMsg}</div>}
            {analysis && (
              <div className="card">
                <div className="upload-analysis-kicker">{analysis.document_type || '분석 결과'}</div>
                <div className="upload-analysis-title">{analysis.filename}</div>
                <div className="upload-analysis-summary">{analysis.summary}</div>

                {(analysis.deadlines || []).length > 0 && (
                  <div className="upload-analysis-section">
                    <div className="upload-analysis-section-title"><Calendar size={16} /> 마감일</div>
                    {analysis.deadlines.map((d, i) => (
                      <div key={i} className="upload-deadline-row">
                        <span className={`upload-deadline-date${d.urgency === 'high' ? ' upload-deadline-date-urgent' : ''}`}>{d.date}</span>
                        <span className="t-body">{d.description}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(analysis.required_documents || []).length > 0 && (
                  <div className="upload-analysis-section">
                    <div className="upload-analysis-section-title"><ListCheck size={16} /> 준비 서류</div>
                    {analysis.required_documents.map((d, i) => (
                      <label key={i} className="upload-doc-row">
                        <input type="checkbox" />
                        <span className="upload-doc-row-name">{d.name}</span>
                        <span className="t-caption">{d.description}</span>
                      </label>
                    ))}
                  </div>
                )}

                {(analysis.calendar_events || []).length > 0 && (
                  <>
                    {calMsg && (
                      <div className={`upload-cal-banner upload-cal-banner-${calMsg.tone}`}>
                        <Calendar size={16} /> {calMsg.text}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      icon={Calendar}
                      className="upload-cal-btn"
                      onClick={async () => {
                        const token = getCalendarToken();
                        if (!token) {
                          setCalMsg({ text: '설정에서 Google 캘린더를 연결하면 일정이 등록됩니다.', tone: 'info' });
                          return;
                        }
                        setCalMsg({ text: '캘린더에 일정 등록 중...', tone: 'success' });
                        try {
                          const { data } = await registerCalendar(analysis.doc_id, token);
                          setCalMsg(
                            data.success
                              ? { text: data.message, tone: 'success' }
                              : { text: `캘린더 등록 실패: ${data.message}`, tone: 'info' }
                          );
                        } catch (e) {
                          setCalMsg({ text: '캘린더 등록 실패: ' + (e.response?.data?.message || e.message), tone: 'info' });
                        }
                      }}
                    >
                      캘린더에 다시 등록 ({(analysis.calendar_events || []).length}개)
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <Card title="분석 완료 문서">
          {completedFiles.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="아직 분석된 문서가 없어요"
              desc="왼쪽에서 파일을 올리면 분석 결과가 여기에 쌓입니다."
            />
          ) : (
            completedFiles.map((f) => <FileRow key={f.id} file={f} onNavTo={onNavTo} />)
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!(uploadConfirm && fileToUpload && queue.length === 0)}
        title="파일 업로드"
        desc={
          fileToUpload && (
            <>
              {[...fileToUpload].slice(0, 2).map((f) => f.name).join(', ')}
              {fileToUpload.length > 2 ? ` 외 ${fileToUpload.length - 2}개` : ''}
              <br />파일을 업로드 하시겠습니까?
            </>
          )
        }
        confirmLabel="확인"
        cancelLabel="취소"
        tone="primary"
        onConfirm={handleConfirmUpload}
        onCancel={handleCancelUpload}
      />

      {/* 업로드 진행 중 팝업 */}
      {uploadConfirm && queue.length > 0 && (
        <div className="dialog-backdrop">
          <div className="dialog upload-progress-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title upload-progress-title">파일 업로드 중</div>
            <div className="upload-progress-list">
              {queue.map((f) => (
                <div key={f.id} className="upload-progress-item">
                  <div className="upload-progress-item-head">
                    <FileText size={18} />
                    <div className="upload-progress-item-body">
                      <div className="upload-progress-item-name">{f.name}</div>
                      <div className="t-caption">{f.size}</div>
                    </div>
                    <div className="upload-progress-item-pct">{Math.round(f.progress)}%</div>
                  </div>
                  <ProgressBar value={f.progress} total={100} />
                </div>
              ))}
            </div>
            {queue.every((f) => f.progress === 100) && (
              <div className="upload-progress-done"><CheckCircle size={16} /> 업로드 완료</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
