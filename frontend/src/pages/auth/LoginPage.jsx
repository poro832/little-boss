export default function LoginPage({ onLogin }) {
  return (
    <div className="card" style={{ margin: 40 }}>
      <button className="btn btn-primary btn-md" onClick={() => onLogin('임시 로그인')}>임시 로그인</button>
    </div>
  );
}
