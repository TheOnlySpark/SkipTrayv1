import React, { useRef, useEffect, useState } from 'react';
import { useNotifications, OrderNotification } from '../contexts/NotificationContext';
import { 
  Bell, 
  CheckCheck, 
  Trash2, 
  X, 
  CheckCircle2, 
  ChefHat, 
  Sparkles, 
  Volume2 
} from 'lucide-react';

// Format helper for timestamps (both relative and exact time)
function formatNotificationTime(timestamp: number): { exact: string; relative: string } {
  const date = new Date(timestamp);
  const exact = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  let relative = 'Just now';

  if (diffSec >= 3600) {
    const hours = Math.floor(diffSec / 3600);
    relative = `${hours}h ago`;
  } else if (diffSec >= 60) {
    const mins = Math.floor(diffSec / 60);
    relative = `${mins}m ago`;
  } else if (diffSec > 10) {
    relative = `${diffSec}s ago`;
  }

  return { exact, relative };
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    isDrawerOpen,
    setIsDrawerOpen,
    markAsRead,
    markAllAsRead,
    clearAll,
    browserPermission,
    requestBrowserPermission,
  } = useNotifications();

  const containerRef = useRef<HTMLDivElement>(null);
  const [filterTab, setFilterTab] = useState<'ALL' | 'UNREAD'>('ALL');
  
  // Track which notifications were unread when this dropdown was opened
  // so they stay highlighted for the duration of the current view
  const [sessionUnreadIds, setSessionUnreadIds] = useState<Set<string>>(new Set());

  // Capture unread IDs when opened
  useEffect(() => {
    if (isDrawerOpen) {
      const currentUnreads = new Set(notifications.filter((n) => !n.read).map((n) => n.id));
      setSessionUnreadIds(currentUnreads);
    } else {
      setSessionUnreadIds(new Set());
    }
  }, [isDrawerOpen]);

  // Automatic Mark-As-Read: After 1.5 seconds of viewing (or immediately upon closing),
  // mark all unread notifications as read
  useEffect(() => {
    if (!isDrawerOpen || unreadCount === 0) return;

    const timer = setTimeout(() => {
      markAllAsRead();
    }, 1500);

    return () => {
      clearTimeout(timer);
      markAllAsRead();
    };
  }, [isDrawerOpen, unreadCount, markAllAsRead]);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!isDrawerOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDrawerOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsDrawerOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDrawerOpen, setIsDrawerOpen]);

  const getStatusBadge = (status: OrderNotification['status']) => {
    switch (status) {
      case 'ACCEPTED':
        return {
          icon: <CheckCircle2 size={16} className="text-blue-600 shrink-0" />,
          bg: 'bg-blue-50 text-blue-700 border-blue-200',
        };
      case 'PREPARING':
        return {
          icon: <ChefHat size={16} className="text-amber-600 shrink-0" />,
          bg: 'bg-amber-50 text-amber-700 border-amber-200',
        };
      case 'READY':
        return {
          icon: <Sparkles size={16} className="text-emerald-600 shrink-0" />,
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-300',
        };
      default:
        return {
          icon: <CheckCircle2 size={16} className="text-indigo-600 shrink-0" />,
          bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        };
    }
  };

  const filteredNotifications = filterTab === 'UNREAD'
    ? notifications.filter((n) => !n.read || sessionUnreadIds.has(n.id))
    : notifications;

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsDrawerOpen((prev) => !prev)}
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        aria-expanded={isDrawerOpen}
        className="relative p-2 md:p-2.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/70 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Bell size={20} className="w-5 h-5 md:w-5 md:h-5 transition-transform active:scale-95" />
        
        {/* Unread Badge Counter */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black text-white shadow-sm ring-2 ring-white animate-in zoom-in duration-200">
            {unreadCount > 9 ? '9+' : unreadCount}
            <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-50 animate-ping" />
          </span>
        )}
      </button>

      {/* Floating Dropdown Panel Directly Under Bell Icon */}
      {isDrawerOpen && (
        <div
          role="region"
          aria-label="Notification Center"
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-white rounded-3xl shadow-2xl border border-slate-200 z-[160] overflow-hidden flex flex-col max-h-[78vh] sm:max-h-[32rem] animate-in fade-in zoom-in-95 duration-200"
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 backdrop-blur-xs">
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm text-slate-900 tracking-tight">Notifications</h3>
              {unreadCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-700">
                  {unreadCount} unread
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500">
                  {notifications.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="px-2 py-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1"
                  title="Mark all as read"
                >
                  <CheckCheck size={14} />
                  <span>Mark read</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Clear all notifications"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors ml-1"
                aria-label="Close notifications"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Filter Tabs: All vs Unread */}
          <div className="flex items-center px-4 py-2 border-b border-slate-100 bg-white gap-2">
            <button
              type="button"
              onClick={() => setFilterTab('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                filterTab === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('UNREAD')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterTab === 'UNREAD'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>Unread</span>
              {unreadCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  filterTab === 'UNREAD' ? 'bg-white text-indigo-700' : 'bg-rose-500 text-white'
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Optional Browser Push Notification Banner */}
          {browserPermission === 'default' && (
            <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-indigo-500/10 border-b border-indigo-100 p-3 flex items-start gap-2.5">
              <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg shrink-0 mt-0.5">
                <Bell size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 leading-tight">Enable Browser Alerts</p>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                  Get notified even when you switch tabs or minimize the browser.
                </p>
                <button
                  type="button"
                  onClick={requestBrowserPermission}
                  className="mt-2 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg shadow-xs transition-colors"
                >
                  Enable Alerts
                </button>
              </div>
            </div>
          )}

          {/* Notifications Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredNotifications.length === 0 ? (
              <div className="py-12 px-6 text-center flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                  <Bell size={22} className="opacity-60" />
                </div>
                <h4 className="text-sm font-bold text-slate-700">
                  {filterTab === 'UNREAD' ? 'No unread notifications' : 'No notifications yet'}
                </h4>
                <p className="text-xs text-slate-400 mt-1 max-w-[220px] leading-relaxed">
                  {filterTab === 'UNREAD'
                    ? 'All notifications have been read. Switch to "All" to view history.'
                    : 'You will receive real-time alerts when your order is accepted, preparing, or ready!'}
                </p>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const { exact, relative } = formatNotificationTime(item.timestamp);
                const badge = getStatusBadge(item.status);
                const isItemUnread = !item.read || sessionUnreadIds.has(item.id);

                return (
                  <div
                    key={item.id}
                    onClick={() => markAsRead(item.id)}
                    className={`p-3.5 transition-all cursor-pointer flex items-start gap-3 relative ${
                      isItemUnread 
                        ? 'bg-indigo-50/40 hover:bg-indigo-50/70 border-l-4 border-l-indigo-600' 
                        : 'bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Status Icon */}
                    <div className="p-2 rounded-xl bg-slate-100 shrink-0 mt-0.5">
                      {badge.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${badge.bg}`}>
                            {item.status}
                          </span>
                          {isItemUnread && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-100 text-rose-700">
                              NEW
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium text-right whitespace-nowrap">
                          <span>{relative}</span>
                          <span className="mx-1">•</span>
                          <span>{exact}</span>
                        </div>
                      </div>

                      <h4 className={`text-xs leading-tight ${isItemUnread ? 'text-indigo-950 font-black' : 'text-slate-800 font-bold'}`}>
                        {item.title}
                      </h4>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                        {item.message}
                      </p>
                    </div>

                    {/* Unread Dot Indicator */}
                    {isItemUnread && (
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 ring-2 ring-indigo-200 shrink-0 mt-1" title="Unread" />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note / sound indicator */}
          <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium px-4">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Volume2 size={13} />
              <span>Chimes enabled</span>
            </span>
            <span className="text-slate-400">SkipTray Live</span>
          </div>
        </div>
      )}
    </div>
  );
}
