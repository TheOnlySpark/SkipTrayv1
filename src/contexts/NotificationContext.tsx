import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { playStatusChime, triggerHapticFeedback, OrderNotificationStatus } from '../utils/notificationSound';

type Order = Database['public']['Tables']['orders']['Row'];

export interface OrderNotification {
  id: string;
  orderId: string;
  orderNumber: number;
  status: OrderNotificationStatus;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

interface NotificationContextType {
  notifications: OrderNotification[];
  unreadCount: number;
  activeToast: OrderNotification | null;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  dismissToast: () => void;
  browserPermission: NotificationPermission | 'unsupported';
  requestBrowserPermission: () => Promise<NotificationPermission | 'unsupported'>;
  triggerTestNotification: (status: OrderNotificationStatus) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

const STORAGE_PREFIX = 'skiptray_notifications_';

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [activeToast, setActiveToast] = useState<OrderNotification | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>('default');

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownStatusMapRef = useRef<Map<string, string>>(new Map());
  const initialFetchDoneRef = useRef(false);

  // Check browser permission status
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserPermission(Notification.permission);
    } else {
      setBrowserPermission('unsupported');
    }
  }, []);

  // Load persisted notifications for user
  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      knownStatusMapRef.current.clear();
      initialFetchDoneRef.current = false;
      return;
    }

    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${user.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setNotifications(parsed);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }, [user?.id]);

  // Save notifications to localStorage whenever they change
  const saveNotifications = useCallback((items: OrderNotification[]) => {
    if (!user?.id) return;
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${user.id}`, JSON.stringify(items.slice(0, 50)));
    } catch {
      // Ignore storage errors
    }
  }, [user?.id]);

  // Request browser notification permission
  const requestBrowserPermission = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPermission('unsupported');
      return 'unsupported';
    }

    try {
      const perm = await Notification.requestPermission();
      setBrowserPermission(perm);
      return perm;
    } catch {
      return 'denied';
    }
  }, []);

  // Dismiss floating toast
  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setActiveToast(null);
  }, []);

  // Trigger browser push notification if permitted
  const sendBrowserNotification = useCallback((title: string, message: string, orderId: string, status: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      const notif = new Notification(title, {
        body: message,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: `order-${orderId}-${status}`,
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    } catch {
      // Ignore notification launch errors
    }
  }, []);

  // Dispatch a notification (audio, haptics, toast, browser push, state)
  const dispatchNotification = useCallback((
    status: OrderNotificationStatus,
    orderId: string,
    orderNumber: number
  ) => {
    let title = '';
    let message = '';

    if (status === 'ACCEPTED') {
      title = `Order #${orderNumber} Accepted`;
      message = 'Your order has been confirmed by the kitchen.';
    } else if (status === 'PREPARING') {
      title = `Kitchen Preparing Order #${orderNumber}`;
      message = 'Your meal is now being freshly prepared.';
    } else if (status === 'READY') {
      title = `Order #${orderNumber} is Ready! 🍽️`;
      message = 'Your food is ready for pickup! Show your QR pass at the counter.';
    }

    const newNotification: OrderNotification = {
      id: `${orderId}-${status}-${Date.now()}`,
      orderId,
      orderNumber,
      status,
      title,
      message,
      timestamp: Date.now(),
      read: false,
    };

    // 1. Play synthesized audio chime
    playStatusChime(status);

    // 2. Mobile haptic vibration
    triggerHapticFeedback(status);

    // 3. Native browser notification
    sendBrowserNotification(title, message, orderId, status);

    // 4. In-App Floating Toast
    setActiveToast(newNotification);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setActiveToast(null);
      toastTimerRef.current = null;
    }, 6500);

    // 5. Update notifications state and storage
    setNotifications((prev) => {
      const updated = [newNotification, ...prev.filter((n) => n.id !== newNotification.id)].slice(0, 50);
      saveNotifications(updated);
      return updated;
    });
  }, [saveNotifications, sendBrowserNotification]);

  // Initial fetch to seed current active order statuses so page loads don't trigger fake alerts
  useEffect(() => {
    if (!user?.id) return;

    let isMounted = true;

    async function seedInitialStatuses() {
      try {
        const { data } = await supabase
          .from('orders')
          .select('id, status, order_number')
          .eq('user_id', user!.id)
          .in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']);

        if (isMounted && data) {
          data.forEach((o) => {
            knownStatusMapRef.current.set(o.id, o.status);
          });
          initialFetchDoneRef.current = true;
        }
      } catch {
        if (isMounted) initialFetchDoneRef.current = true;
      }
    }

    seedInitialStatuses();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  // Subscribe to Supabase Realtime changes for orders of this user
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`user_order_notifications_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newOrder = payload.new as Order | null;
          if (!newOrder || !newOrder.id) return;

          const prevStatus = knownStatusMapRef.current.get(newOrder.id);
          const currentStatus = newOrder.status;

          // Always update our tracked status
          knownStatusMapRef.current.set(newOrder.id, currentStatus);

          // If this is during initial load or status hasn't transitioned, skip
          if (!initialFetchDoneRef.current && !prevStatus) return;
          if (prevStatus === currentStatus) return;

          // Only alert when advancing to ACCEPTED, PREPARING, or READY
          if (
            currentStatus === 'ACCEPTED' ||
            currentStatus === 'PREPARING' ||
            currentStatus === 'READY'
          ) {
            dispatchNotification(
              currentStatus as OrderNotificationStatus,
              newOrder.id,
              newOrder.order_number
            );
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user?.id, dispatchNotification]);

  // Mark a single notification as read
  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      saveNotifications(updated);
      return updated;
    });
  }, [saveNotifications]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      saveNotifications(updated);
      return updated;
    });
  }, [saveNotifications]);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
    if (user?.id) {
      try {
        localStorage.removeItem(`${STORAGE_PREFIX}${user.id}`);
      } catch {
        // Ignore storage errors
      }
    }
  }, [user?.id]);

  // Trigger test notification for easy testing
  const triggerTestNotification = useCallback((status: OrderNotificationStatus) => {
    dispatchNotification(status, 'test-' + Date.now(), 99);
  }, [dispatchNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        activeToast,
        isDrawerOpen,
        setIsDrawerOpen,
        markAsRead,
        markAllAsRead,
        clearAll,
        dismissToast,
        browserPermission,
        requestBrowserPermission,
        triggerTestNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return ctx;
}
