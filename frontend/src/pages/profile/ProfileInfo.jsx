import { useState, useRef } from 'react';
import { getUser, isEmailUser, updateLocalProfile } from '../../lib/auth';
import { updateProfile, changePassword } from '../../lib/api';
import { useTheme } from '../../lib/useTheme';
import Card from '../../components/Card';
import Field from '../../components/Field';
import Button from '../../components/Button';

// LittleBoss.jsx:1931-2383 이관 (프로필 사진·기본 정보·비밀번호 변경 부분).
// 프로필 사진은 세션 데이터가 아니라 UI 상태라서 Header.jsx와 같은 방식으로 localStorage를 직접 쓴다.
const readProfileImage = () => {
  try { return localStorage.getItem('profileImage'); } catch { return null; }
};

const THEME_OPTIONS = [
  ['system', '시스템 설정'],
  ['light', '라이트'],
  ['dark', '다크'],
];

export default function ProfileInfo({ toast }) {
  const user = getUser();
  const emailUser = isEmailUser();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef(null);

  const [name, setName] = useState(user.name || '');
  const [affiliation, setAffiliation] = useState(user.affiliation);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileImage, setProfileImage] = useState(readProfileImage);

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async () => {
    if (!name.trim()) { toast('이름을 입력해주세요'); return; }
    setSavingProfile(true);
    try {
      const { data } = await updateProfile(user.id, name.trim(), affiliation.trim());
      if (!data.success) throw new Error(data.message);
      updateLocalProfile({ name: name.trim(), affiliation: affiliation.trim() });
      toast('프로필이 저장되었습니다');
    } catch (e) {
      toast(e.response?.data?.message || e.message || '저장에 실패했어요');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (!curPw || !newPw) { toast('비밀번호를 입력해주세요'); return; }
    if (newPw !== confirmPw) { toast('새 비밀번호가 일치하지 않습니다'); return; }
    if (newPw.length < 8) { toast('새 비밀번호는 8자 이상이어야 합니다'); return; }
    setSavingPw(true);
    try {
      const { data } = await changePassword(user.id, curPw, newPw);
      if (!data.success) throw new Error(data.message);
      toast('비밀번호가 변경되었습니다');
      setCurPw(''); setNewPw(''); setConfirmPw('');
    } catch (e) {
      toast(e.response?.data?.message || e.message || '변경에 실패했어요');
    } finally {
      setSavingPw(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !['image/png', 'image/jpeg'].includes(file.type)) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      setProfileImage(result);
      try { localStorage.setItem('profileImage', result); } catch { /* 차단 환경 */ }
      window.dispatchEvent(new CustomEvent('profileImageUpdated', { detail: result }));
    };
    reader.readAsDataURL(file);
  };

  const handleImageRemove = () => {
    setProfileImage(null);
    try { localStorage.removeItem('profileImage'); } catch { /* 차단 환경 */ }
    window.dispatchEvent(new CustomEvent('profileImageUpdated', { detail: null }));
  };

  return (
    <div className="profile-panel">
      <Card className="profile-section">
        <div className="profile-photo-row">
          <div className="profile-photo">
            {profileImage ? <img src={profileImage} alt="" /> : (user.name || '사')[0]}
          </div>
          <div>
            <div className="t-section">{user.name}</div>
            <div className="t-caption profile-photo-email">{user.email}</div>
            <div className="profile-photo-actions">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                사진 변경
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleImageRemove}>
                삭제
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="upload-input-hidden"
              onChange={handleImageChange}
            />
          </div>
        </div>
      </Card>

      <Card title="기본 정보" className="profile-section">
        <Field
          label="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름"
        />
        <Field
          label="이메일"
          value={user.email}
          disabled
          hint="가입 시 사용한 이메일은 변경할 수 없어요."
        />
        <Field
          label="소속"
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
          placeholder="예: 소프트웨어학과"
          hint="소속을 입력하면 학과별 공지에 맞춘 안내를 받을 수 있어요."
        />
        <Button variant="primary" onClick={saveProfile} disabled={savingProfile}>
          {savingProfile ? '저장 중...' : '프로필 저장'}
        </Button>
      </Card>

      {emailUser ? (
        <Card title="비밀번호 변경" className="profile-section">
          <Field
            label="현재 비밀번호"
            type="password"
            value={curPw}
            onChange={(e) => setCurPw(e.target.value)}
            placeholder="현재 비밀번호"
          />
          <Field
            label="새 비밀번호"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="새 비밀번호 (8자 이상)"
          />
          <Field
            label="새 비밀번호 확인"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="새 비밀번호 재입력"
          />
          <Button variant="primary" onClick={savePassword} disabled={savingPw}>
            {savingPw ? '변경 중...' : '비밀번호 변경'}
          </Button>
        </Card>
      ) : (
        <Card title="비밀번호" className="profile-section">
          <div className="t-body">Google 로그인 계정은 별도 비밀번호가 없습니다. 비밀번호는 Google 계정에서 관리됩니다.</div>
        </Card>
      )}

      <Card title="화면 설정" className="profile-section">
        <div className="theme-row">
          {THEME_OPTIONS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`theme-opt ${theme === v ? 'theme-opt-on' : ''}`}
              onClick={() => setTheme(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
