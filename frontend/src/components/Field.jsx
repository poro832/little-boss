export default function Field({ label, hint, error, id, ...rest }) {
  const inputId = id || `f-${label}`;
  return (
    <div className="field">
      {label && <label className="field-label" htmlFor={inputId}>{label}</label>}
      <input id={inputId} className="field-input" {...rest} />
      {hint && !error && <div className="field-hint">{hint}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
