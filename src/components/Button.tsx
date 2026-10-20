import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | 'teritiory'; // Supporting both spellings for convenience
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  className = '',
  type = 'button',
  ...props
}, ref) => {
  // Normalize spelling for tertiary / teritiory
  const normalizedVariant: ButtonVariant =
    variant === 'teritiory' ? 'tertiary' : variant;

  // Base styles
  const baseStyles =
    'relative inline-flex items-center justify-center font-semibold transition-all duration-200 select-none outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:active:scale-100 disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  // Variant styles
  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      'bg-[#1d68f2] hover:bg-[#1656cb] active:bg-[#1147ac] text-white shadow-sm shadow-blue-500/25 focus-visible:ring-blue-500 border border-transparent',
    secondary:
      'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 shadow-2xs hover:border-slate-300 focus-visible:ring-slate-400',
    tertiary:
      'bg-transparent hover:bg-slate-100/80 active:bg-slate-200/70 text-slate-600 hover:text-slate-900 border border-transparent focus-visible:ring-slate-400',
    danger:
      'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-sm shadow-rose-600/25 focus-visible:ring-rose-500 border border-transparent',
    success:
      'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm shadow-emerald-600/25 focus-visible:ring-emerald-500 border border-transparent'
  };

  // Size styles
  const sizeStyles: Record<ButtonSize, string> = {
    sm: 'text-xs px-3 py-1.5 rounded-lg gap-1.5',
    md: 'text-sm px-4 py-2.5 rounded-xl gap-2',
    lg: 'text-base px-5 py-3 rounded-xl gap-2.5'
  };

  const spinnerSize = size === 'sm' ? 14 : size === 'lg' ? 20 : 16;
  const isButtonDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isButtonDisabled}
      className={`
        ${baseStyles}
        ${variantStyles[normalizedVariant]}
        ${sizeStyles[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 size={spinnerSize} className="animate-spin shrink-0" />
          <span>{loadingText || children}</span>
        </>
      ) : (
        <>
          {leftIcon && <span className="inline-flex shrink-0 items-center justify-center">{leftIcon}</span>}
          {children && <span>{children}</span>}
          {rightIcon && <span className="inline-flex shrink-0 items-center justify-center">{rightIcon}</span>}
        </>
      )}
    </button>
  );
});

Button.displayName = 'Button';
export default Button;
