import React, { forwardRef, useState, useId } from 'react';
import { Eye, EyeOff, AlertCircle, CheckCircle2, X } from 'lucide-react';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: string | boolean;
  success?: string | boolean;
  size?: InputSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  showPasswordToggle?: boolean;
  showCount?: boolean;
  fullWidth?: boolean;
  containerClassName?: string;
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(({
  label,
  helperText,
  error,
  success,
  size = 'md',
  leftIcon,
  rightIcon,
  clearable = false,
  onClear,
  showPasswordToggle = true,
  showCount = false,
  fullWidth = true,
  containerClassName = '',
  className = '',
  type = 'text',
  id: customId,
  required,
  disabled,
  value,
  defaultValue,
  maxLength,
  onChange,
  ...props
}, ref) => {
  const generatedId = useId();
  const inputId = customId || generatedId;

  // Track password visibility if input is a password
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const effectiveType = isPassword ? (showPassword ? 'text' : 'password') : type;

  // Internal value tracking for clearable & count when uncontrolled
  const [internalVal, setInternalVal] = useState<string>(
    String(value ?? defaultValue ?? '')
  );

  const currentValue = value !== undefined ? String(value) : internalVal;
  const hasValue = currentValue.length > 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (value === undefined) {
      setInternalVal(e.target.value);
    }
    onChange?.(e);
  };

  const handleClear = () => {
    if (value === undefined) {
      setInternalVal('');
    }
    onClear?.();
  };

  // State flags
  const isError = Boolean(error);
  const isSuccess = Boolean(success) && !isError;
  const errorMessage = typeof error === 'string' ? error : undefined;
  const successMessage = typeof success === 'string' ? success : undefined;

  // Size styling for input padding and heights
  const sizeStyles: Record<InputSize, { input: string; icon: string; text: string }> = {
    sm: {
      input: 'py-1.5 text-xs rounded-lg',
      icon: 'w-4 h-4',
      text: 'text-xs'
    },
    md: {
      input: 'py-2.5 text-sm rounded-xl',
      icon: 'w-4 h-4',
      text: 'text-sm'
    },
    lg: {
      input: 'py-3 text-base rounded-xl',
      icon: 'w-5 h-5',
      text: 'text-base'
    }
  };

  // Border & Focus styling — single crisp border only
  let borderStyles = 'border-slate-300 focus:border-indigo-600 focus:outline-none focus:ring-0';
  if (isError) {
    borderStyles = 'border-rose-400 bg-rose-50/20 text-rose-900 focus:border-rose-600 focus:outline-none focus:ring-0';
  } else if (isSuccess) {
    borderStyles = 'border-emerald-400 bg-emerald-50/20 text-emerald-900 focus:border-emerald-600 focus:outline-none focus:ring-0';
  }

  return (
    <div className={`${fullWidth ? 'w-full' : 'inline-block'} ${containerClassName}`}>
      {/* Label and Character Count */}
      {(label || (showCount && maxLength)) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && (
            <label
              htmlFor={inputId}
              className={`block font-semibold text-slate-700 ${sizeStyles[size].text}`}
            >
              {label}
              {required && <span className="text-rose-500 ml-1 font-bold">*</span>}
            </label>
          )}

          {showCount && maxLength && (
            <span className="text-xs text-slate-400 font-mono ml-auto">
              {currentValue.length} / {maxLength}
            </span>
          )}
        </div>
      )}

      {/* Input Field Container */}
      <div className="relative flex items-center">
        {/* Left Icon */}
        {leftIcon && (
          <div className="absolute left-3.5 flex items-center justify-center text-slate-400 pointer-events-none shrink-0">
            {leftIcon}
          </div>
        )}

        {/* Core Input Element */}
        <input
          ref={ref}
          id={inputId}
          type={effectiveType}
          disabled={disabled}
          required={required}
          value={value}
          defaultValue={defaultValue}
          maxLength={maxLength}
          onChange={handleChange}
          className={`
            w-full transition-colors duration-150 outline-none focus:outline-none bg-white text-slate-900 placeholder:text-slate-400 border font-normal
            ${leftIcon ? 'pl-10' : 'pl-3.5'}
            ${rightIcon || isPassword || (clearable && hasValue) || isError || isSuccess ? 'pr-10' : 'pr-3.5'}
            ${sizeStyles[size].input}
            ${borderStyles}
            ${disabled ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed select-none' : ''}
            ${className}
          `}
          {...props}
        />

        {/* Right-side action controls: Clear / Password Toggle / Status Icon */}
        <div className="absolute right-3.5 flex items-center gap-1.5 shrink-0">
          {/* Clear button */}
          {clearable && hasValue && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors"
              title="Clear input"
              aria-label="Clear input"
            >
              <X size={15} />
            </button>
          )}

          {/* Password toggle button */}
          {isPassword && showPasswordToggle && !disabled && (
            <button
              type="button"
              onClick={() => setShowPassword(prev => !prev)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors focus:outline-hidden"
              title={showPassword ? 'Hide password' : 'Show password'}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}

          {/* Error icon indicator */}
          {isError && (
            <span className="text-rose-500 pointer-events-none">
              <AlertCircle size={16} />
            </span>
          )}

          {/* Success icon indicator */}
          {isSuccess && (
            <span className="text-emerald-500 pointer-events-none">
              <CheckCircle2 size={16} />
            </span>
          )}

          {/* Custom Right Icon */}
          {rightIcon && !isError && !isSuccess && (
            <span className="text-slate-400 pointer-events-none">
              {rightIcon}
            </span>
          )}
        </div>
      </div>

      {/* Helper text / Error text message */}
      {errorMessage && (
        <p className="mt-1.5 text-xs text-rose-600 font-medium flex items-center gap-1">
          <span>{errorMessage}</span>
        </p>
      )}

      {!errorMessage && successMessage && (
        <p className="mt-1.5 text-xs text-emerald-600 font-medium flex items-center gap-1">
          <span>{successMessage}</span>
        </p>
      )}

      {!errorMessage && !successMessage && helperText && (
        <p className="mt-1.5 text-xs text-slate-500">
          {helperText}
        </p>
      )}
    </div>
  );
});

InputField.displayName = 'InputField';

// Export aliases
export const Input = InputField;
export default InputField;
