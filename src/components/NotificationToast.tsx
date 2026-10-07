import React from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { X, CheckCircle2, ChefHat, Sparkles } from 'lucide-react';

export function NotificationToast() {
  const { activeToast, dismissToast, setIsDrawerOpen } = useNotifications();

  if (!activeToast) return null;

  const { status, title, message } = activeToast;

  const getStatusStyles = () => {
    switch (status) {
      case 'ACCEPTED':
        return {
          wrapper: 'border-blue-200 bg-white/95 text-slate-800 shadow-blue-500/15',
          iconBg: 'bg-blue-100 text-blue-600',
          badge: 'bg-blue-50 text-blue-700 border-blue-200',
          progress: 'bg-blue-500',
          Icon: CheckCircle2,
        };
      case 'PREPARING':
        return {
          wrapper: 'border-amber-200 bg-white/95 text-slate-800 shadow-amber-500/15',
          iconBg: 'bg-amber-100 text-amber-600',
          badge: 'bg-amber-50 text-amber-700 border-amber-200',
          progress: 'bg-amber-500',
          Icon: ChefHat,
        };
      case 'READY':
        return {
          wrapper: 'border-emerald-300 bg-white/98 text-slate-800 shadow-emerald-500/25 ring-2 ring-emerald-400/40',
          iconBg: 'bg-emerald-100 text-emerald-600',
          badge: 'bg-emerald-50 text-emerald-700 border-emerald-300',
          progress: 'bg-emerald-500',
          Icon: Sparkles,
        };
      default:
        return {
          wrapper: 'border-indigo-200 bg-white text-slate-800 shadow-indigo-500/15',
          iconBg: 'bg-indigo-100 text-indigo-600',
          badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          progress: 'bg-indigo-500',
          Icon: CheckCircle2,
        };
    }
  };

  const styles = getStatusStyles();
  const IconComponent = styles.Icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-14 left-4 right-4 sm:left-auto sm:right-6 sm:top-16 z-[150] sm:max-w-md w-auto"
    >
      <div
        className={`relative overflow-hidden rounded-2xl border p-4 shadow-2xl backdrop-blur-md transition-all duration-300 transform translate-y-0 opacity-100 animate-in fade-in slide-in-from-top-3 ${styles.wrapper}`}
      >
        <div className="flex items-start gap-3.5">
          {/* Status Icon */}
          <div className={`p-2.5 rounded-xl shrink-0 flex items-center justify-center ${styles.iconBg}`}>
            <IconComponent size={22} className="shrink-0" />
          </div>

          {/* Text Content */}
          <div className="flex-1 min-w-0 pr-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${styles.badge}`}>
                {status}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">Just now</span>
            </div>
            <h4 className="text-sm font-extrabold text-slate-900 leading-snug truncate">
              {title}
            </h4>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              {message}
            </p>

            <button
              type="button"
              onClick={() => {
                dismissToast();
                setIsDrawerOpen(true);
              }}
              className="mt-2 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1"
            >
              View in Notification History &rarr;
            </button>
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={dismissToast}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>

        {/* Dynamic Countdown Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100 overflow-hidden">
          <div
            className={`h-full ${styles.progress} animate-pulse`}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}

