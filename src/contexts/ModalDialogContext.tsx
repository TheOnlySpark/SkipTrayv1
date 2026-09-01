import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { 
  IconAlertTriangle, 
  IconBan, 
  IconCheckCircle, 
  IconClock, 
  IconHourglass,
  IconX 
} from '../components/Icons';

export type DialogType = 'info' | 'warning' | 'error' | 'success' | 'danger';

interface AlertOptions {
  title?: string;
  message: string;
  type?: DialogType;
  confirmText?: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  type?: DialogType;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

interface ModalDialogContextType {
  showAlert: (options: AlertOptions | string) => Promise<void>;
  showConfirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

const ModalDialogContext = createContext<ModalDialogContextType | null>(null);

export function ModalDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirm, setIsConfirm] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<DialogType>('info');
  const [confirmText, setConfirmText] = useState('OK');
  const [cancelText, setCancelText] = useState('Cancel');
  const [isDangerous, setIsDangerous] = useState(false);

  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const showAlert = useCallback((options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      const opts: AlertOptions = typeof options === 'string' ? { message: options } : options;
      setIsConfirm(false);
      setTitle(opts.title || getDefaultTitle(opts.type || 'info'));
      setMessage(opts.message);
      setType(opts.type || 'info');
      setConfirmText(opts.confirmText || 'Got It');
      setIsDangerous(false);
      setIsOpen(true);

      resolverRef.current = () => {
        resolve();
      };
    });
  }, []);

  const showConfirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
      setIsConfirm(true);
      setTitle(opts.title || (opts.isDangerous ? 'Confirm Action' : 'Are You Sure?'));
      setMessage(opts.message);
      setType(opts.type || (opts.isDangerous ? 'danger' : 'warning'));
      setConfirmText(opts.confirmText || 'Confirm');
      setCancelText(opts.cancelText || 'Cancel');
      setIsDangerous(opts.isDangerous || opts.type === 'danger');
      setIsOpen(true);

      resolverRef.current = (val: boolean) => {
        resolve(val);
      };
    });
  }, []);

  const handleConfirm = () => {
    setIsOpen(false);
    if (resolverRef.current) resolverRef.current(true);
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolverRef.current) resolverRef.current(false);
  };

  function getDefaultTitle(t: DialogType): string {
    switch (t) {
      case 'warning': return 'Notice';
      case 'error':
      case 'danger': return 'Attention Required';
      case 'success': return 'Success';
      default: return 'Information';
    }
  }

  function renderIcon() {
    switch (type) {
      case 'danger':
      case 'error':
        return (
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-1 shrink-0 shadow-sm border border-rose-200">
            <IconAlertTriangle size={24} className="w-6 h-6" />
          </div>
        );
      case 'warning':
        return (
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mb-1 shrink-0 shadow-sm border border-amber-200">
            <IconClock size={24} className="w-6 h-6" />
          </div>
        );
      case 'success':
        return (
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-1 shrink-0 shadow-sm border border-emerald-200">
            <IconCheckCircle size={24} className="w-6 h-6" />
          </div>
        );
      default:
        return (
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-1 shrink-0 shadow-sm border border-indigo-200">
            <IconHourglass size={24} className="w-6 h-6" />
          </div>
        );
    }
  }

  return (
    <ModalDialogContext.Provider value={{ showAlert, showConfirm }}>
      {children}

      {/* Sleek Glassmorphic Modal Dialog Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
          <div 
            className="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl border border-slate-100 flex flex-col gap-4 relative animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
          >
            {/* Close cross for dismiss */}
            <button
              onClick={handleCancel}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors"
              aria-label="Close"
            >
              <IconX size={18} className="w-4.5 h-4.5" />
            </button>

            {/* Header & Icon */}
            <div className="flex items-start gap-4">
              {renderIcon()}
              <div className="flex-1 pt-0.5">
                <h3 className="text-lg font-extrabold text-slate-900 leading-snug">
                  {title}
                </h3>
                <div className="text-sm text-slate-600 mt-1.5 whitespace-pre-line leading-relaxed font-normal">
                  {message}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-slate-100">
              {isConfirm && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  {cancelText}
                </button>
              )}
              <button
                type="button"
                onClick={handleConfirm}
                autoFocus
                className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm transition-all ${
                  isDangerous
                    ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
                    : type === 'success'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                    : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalDialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(ModalDialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within a ModalDialogProvider');
  }
  return ctx;
}
