import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { getUser, getCalendarToken, saveCalendarToken, clearCalendarToken, clearSession } from '../../lib/auth';
import { deleteAccount } from '../../lib/api';
import Card from '../../components/Card';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Calendar } from '../../icons';

// LittleBoss.jsx:1931-2383, 287-304 이관 (캘린더 연동/해제, 회원 탈퇴).
// 토큰 만료는 로그인 세션과 무관하다 — clearSession()을 호출하지 않고
// getCalendarToken()/clearCalendarToken()만으로 "연결되지 않음" 상태를 표시한다.

function ConnectCalendarButton({ toast, onConnected }) {
  const connect = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/calendar.events',
    prompt: 'select_account', // 항상 계정 선택창을 띄워 의도한 계정으로 연결되게
    onSuccess: (tokenResponse) => {
      saveCalendarToken(tokenResponse.access_token);
      toast?.('Google 캘린더가 연결됐어요');
      onConnected?.();
    },
    onError: () => toast?.('Google 캘린더 연결 실패. 다시 시도해주세요.'),
  });

  return (
    <Button type="button" variant="outline" icon={Calendar} onClick={() => connect()}>
      Google 캘린더 연결하기
    </Button>
  );
}

export default function Connections({ toast, onLogout }) {
  const user = getUser();
  const [connected, setConnected] = useState(!!getCalendarToken());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDisconnect = () => {
    clearCalendarToken();
    setConnected(false);
    toast?.('캘린더 연결을 해제했어요');
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { data } = await deleteAccount(user.id);
      if (!data.success) throw new Error(data.message);
      clearSession();
      toast('회원 탈퇴가 완료되었습니다');
      onLogout?.();
    } catch (e) {
      toast(e.response?.data?.message || e.message || '탈퇴에 실패했어요');
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <div className="profile-panel">
      <Card title="Google 캘린더 연동" className="profile-section">
        {connected ? (
          <div className="connection-status connection-status-on">
            <Calendar size={20} />
            <div>
              <div className="t-body connection-status-label">연동 완료</div>
              <div className="t-caption">{user.email || 'Google 계정'}</div>
            </div>
          </div>
        ) : (
          <div className="connection-status connection-status-off">
            <Calendar size={20} />
            <div>
              <div className="t-body connection-status-label">연결되지 않음</div>
              <div className="t-caption">연결이 끊어져도 로그인 상태는 그대로 유지돼요. 아래 버튼으로 다시 연결하세요.</div>
            </div>
          </div>
        )}
        <div className="t-body profile-connection-desc">
          문서 분석이 완료되면 일정이 Google 캘린더에 자동 등록됩니다. 각 일정에는 마감 D-7·D-3·D-1 리마인더가 함께 설정됩니다.
        </div>
        {connected ? (
          <Button type="button" variant="outline" onClick={handleDisconnect}>캘린더 연결 해제</Button>
        ) : (
          <ConnectCalendarButton toast={toast} onConnected={() => setConnected(true)} />
        )}
      </Card>

      <Card title="회원 탈퇴" className="profile-section">
        <div className="t-body profile-connection-desc">탈퇴 시 업로드한 모든 문서가 함께 삭제되며 복구할 수 없습니다.</div>
        <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>회원 탈퇴</Button>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        title="정말 탈퇴하시겠어요?"
        desc="모든 문서가 삭제되며 복구할 수 없습니다."
        confirmLabel="탈퇴"
        cancelLabel="취소"
        tone="danger"
        busy={deleting}
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
