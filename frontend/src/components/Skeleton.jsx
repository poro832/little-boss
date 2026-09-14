export default function Skeleton({ rows = 3 }) {
  return (
    <div className="card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}
