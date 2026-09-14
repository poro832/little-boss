export default function Chip({ tone = 'brand', children, ...rest }) {
  return <span className={`chip chip-${tone}`} {...rest}>{children}</span>;
}
