export default function Toast({ msg, show }) {
  return <div className={`toast ${show ? 'toast-show' : ''}`} role="status">{msg}</div>;
}
