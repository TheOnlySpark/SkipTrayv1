import React, { useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, Sparkles } from 'lucide-react';
import Button, { ButtonVariant } from './Button';

export type ModalVariant = 'success' | 'danger' | 'info' | 'infomodel' | 'default';
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalAction {
  label: string;
  onClick: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: ModalVariant;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  primaryAction?: ModalAction;
  secondaryAction?: ModalAction;
  footer?: React.ReactNode;
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  size?: ModalSize;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  variant = 'default',
  title,
  description,
  children,
  icon,
  primaryAction,
  secondaryAction,
  footer,
  closeOnBackdropClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  size = 'md',
  className = ''
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Normalize variant ('infomodel' -> 'info')
  const normalizedVariant: 'success' | 'danger' | 'info' | 'default' =
    variant === 'infomodel' ? 'info' : variant;

  // ESC key listener to close modal
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEsc, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Variant design tokens: icons, colors, button styles
  const variantConfig = {
    success: {
      defaultIcon: <CheckCircle2 className="w-6 h-6 text-emerald-600" />,
      iconBg: 'bg-emerald-50 border-emerald-200 text-emerald-600',
      glow: 'shadow-emerald-500/10',
      badgeText: 'Success',
      defaultButtonVariant: 'success' as ButtonVariant
    },
    danger: {
      defaultIcon: <AlertTriangle className="w-6 h-6 text-rose-600" />,
      iconBg: 'bg-rose-50 border-rose-200 text-rose-600',
      glow: 'shadow-rose-500/10',
      badgeText: 'Warning',
      defaultButtonVariant: 'danger' as ButtonVariant
    },
    info: {
      defaultIcon: <Info className="w-6 h-6 text-indigo-600" />,
      iconBg: 'bg-indigo-50 border-indigo-200 text-indigo-600',
      glow: 'shadow-indigo-500/10',
      badgeText: 'Information',
      defaultButtonVariant: 'primary' as ButtonVariant
    },
    default: {
      defaultIcon: null,
      iconBg: 'bg-slate-100 border-slate-200 text-slate-700',
      glow: 'shadow-slate-500/10',
      badgeText: null,
      defaultButtonVariant: 'primary' as ButtonVariant
    }
  };

  const config = variantConfig[normalizedVariant];

  // Size widths
  const sizeStyles: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl'
  };

  const effectiveIcon = icon !== undefined ? icon : config.defaultIcon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      {/* 1. Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in"
        onClick={() => {
          if (closeOnBackdropClick) onClose();
        }}
        aria-hidden="true"
      />

      {/* 2. Modal Card Container */}
      <div
        ref={modalRef}
        className={`
          relative w-full bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden z-10 my-auto
          animate-in fade-in zoom-in-95 duration-200
          ${sizeStyles[size]}
          ${className}
        `}
      >
        {/* Close Button Top Right */}
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors focus:outline-hidden"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        )}

        {/* Modal Header & Content */}
        <div className="p-6 sm:p-7">
          {/* Header with Icon and Title */}
          {(effectiveIcon || title) && (
            <div className="flex items-start gap-4 mb-3">
              {effectiveIcon && (
                <div
                  className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 shadow-xs ${config.iconBg}`}
                >
                  {effectiveIcon}
                </div>
              )}

              <div className="flex-1 min-w-0 pt-0.5">
                {title && (
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight leading-snug">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                    {description}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Fallback description if no icon/title block was used */}
          {!effectiveIcon && !title && description && (
            <p className="text-sm text-slate-500 leading-relaxed mb-4">
              {description}
            </p>
          )}

          {/* Modal Custom Body */}
          {children && (
            <div className="mt-4 text-sm text-slate-700">
              {children}
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        {(footer !== undefined || primaryAction || secondaryAction) && (
          <div className="px-6 py-4 bg-slate-50/80 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
            {footer ? (
              footer
            ) : (
              <>
                {secondaryAction && (
                  <Button
                    variant="secondary"
                    onClick={secondaryAction.onClick}
                    disabled={secondaryAction.disabled}
                  >
                    {secondaryAction.label}
                  </Button>
                )}
                {primaryAction && (
                  <Button
                    variant={primaryAction.variant || config.defaultButtonVariant}
                    onClick={primaryAction.onClick}
                    loading={primaryAction.loading}
                    disabled={primaryAction.disabled}
                  >
                    {primaryAction.label}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Convenient Pre-configured Variant Components ───────────────────────────

export function SuccessModal(props: Omit<ModalProps, 'variant'>) {
  return <Modal {...props} variant="success" />;
}

export function DangerModal(props: Omit<ModalProps, 'variant'>) {
  return <Modal {...props} variant="danger" />;
}

export function InfoModal(props: Omit<ModalProps, 'variant'>) {
  return <Modal {...props} variant="info" />;
}

export default Modal;
