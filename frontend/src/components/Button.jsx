import { forwardRef } from 'react';

const Button = forwardRef(function Button({ variant = 'primary', size = 'md', icon: Icon, className = '', children, ...rest }, ref) {
  return (
    <button ref={ref} className={`btn btn-${variant} btn-${size} ${className}`.trim()} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
});

export default Button;
