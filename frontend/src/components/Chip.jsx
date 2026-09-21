export default function Chip({ tone = 'brand', className = '', children, ...rest }) {
  return <span className={`chip chip-${tone} ${className}`.trim()} {...rest}>{children}</span>;
}
