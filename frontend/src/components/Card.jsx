export default function Card({ title, actions, className = '', children, ...rest }) {
  return (
    <div className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          {title && <div className="t-section">{title}</div>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
