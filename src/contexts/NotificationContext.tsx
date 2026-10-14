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
  deleteNotification: (id: string) => void;
  clearAll: () => void;
  dismissToast: () => void;
  browserPermission: NotificationPermission | 'unsupported';
  requestBrowserPermission: () => Promise<NotificationPermission | 'unsupported'>;
  triggerTestNotification: (status: OrderNotificationStatus) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

const STORAGE_PREFIX = 'skiptray_notifications_';

function getStorageSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // Ignore storage errors
  }
  return new Set();
}

function addToStorageSet(key: string, id: string): void {
  try {
    const set = getStorageSet(key);
    set.add(id);
    localStorage.setItem(key, JSON.stringify(Array.from(set).slice(-200)));
  } catch {
    // Ignore storage errors
  }
}

function loadLocalCache(userId: string): OrderNotification[] {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore storage errors
  }
  return [];
}

function saveLocalCache(userId: string, items: OrderNotification[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Ignore storage errors
  }
}

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

  // Fetch and load persisted notification history whenever authenticated user changes
  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      knownStatusMapRef.current.clear();
      initialFetchDoneRef.current = false;
      return;
    }

    let isMounted = true;

    async function loadUserNotifications() {
      if (!user?.id) return;

      const deletedSetKey = `${STORAGE_PREFIX}deleted_${user.id}`;
      const readSetKey = `${STORAGE_PREFIX}read_${user.id}`;
      const deletedIds = getStorageSet(deletedSetKey);
      const readIds = getStorageSet(readSetKey);

      try {
        // 1. Primary: fetch from backend user_notifications table in Supabase
        const { data: dbData, error: dbError } = await supabase
          .from('user_notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!dbError && dbData && dbData.length > 0) {
          if (isMounted) {
            const mapped: OrderNotification[] = dbData
              .filter((row) => !deletedIds.has(row.id))
              .map((row) => ({
                id: row.id,
                orderId: row.order_id || '',
                orderNumber: row.order_number || 0,
                status: row.status as OrderNotificationStatus,
                title: row.title,
                message: row.message,
                timestamp: new Date(row.created_at).getTime(),
                read: row.read || readIds.has(row.id),
              }));

            setNotifications(mapped);
            saveLocalCache(user.id, mapped);
            initialFetchDoneRef.current = true;
          }
          return;
        }

        // 2. Resilient fallback: synchronize from user's persisted orders in Supabase
        const { data: orders, error: ordersError } = await supabase
          .from('orders')
          .select('id, status, order_number, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30);

        if (!ordersError && orders) {
          const derived: OrderNotification[] = [];

          for (const o of orders) {
            knownStatusMapRef.current.set(o.id, o.status);

            const milestones: OrderNotificationStatus[] = [];
            if (['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'].includes(o.status)) {
              milestones.push('ACCEPTED');
            }
            if (['PREPARING', 'READY', 'COLLECTED'].includes(o.status)) {
              milestones.push('PREPARING');
            }
            if (['READY', 'COLLECTED'].includes(o.status)) {
              milestones.push('READY');
            }

            for (const m of milestones) {
              const notifId = `${o.id}-${m}`;
              if (deletedIds.has(notifId)) continue;

              let title = '';
              let message = '';
              if (m === 'ACCEPTED') {
                title = `Order #${o.order_number} Accepted`;
                message = 'Your order has been confirmed by the kitchen.';
              } else if (m === 'PREPARING') {
                title = `Kitchen Preparing Order #${o.order_number}`;
                message = 'Your meal is now being freshly prepared.';
              } else if (m === 'READY') {
                title = `Order #${o.order_number} is Ready! 🍽️`;
                message = 'Your food is ready for pickup! Show your QR pass at the counter.';
              }

              derived.push({
                id: notifId,
                orderId: o.id,
                orderNumber: o.order_number,
                status: m,
                title,
                message,
                timestamp: new Date(o.created_at).getTime(),
                read: readIds.has(notifId) || o.status === 'COLLECTED',
              });
            }
          }

          derived.sort((a, b) => b.timestamp - a.timestamp);

          if (isMounted) {
            setNotifications(derived);
            saveLocalCache(user.id, derived);
            initialFetchDoneRef.current = true;
          }

          // If user_notifications table is reachable, backfill derived records
          if (!dbError) {
            for (const notif of derived.slice(0, 20)) {
              supabase.from('user_notifications').upsert({
                id: notif.id,
                user_id: user.id,
                order_id: notif.orderId,
                order_number: notif.orderNumber,
                status: notif.status,
                title: notif.title,
                message: notif.message,
                read: notif.read,
                created_at: new Date(notif.timestamp).toISOString(),
              }, { onConflict: 'id' }).then(() => {});
            }
          }
          return;
        }

        // 3. Fallback to cached notifications
        if (isMounted) {
          const cached = loadLocalCache(user.id);
          setNotifications(cached);
          initialFetchDoneRef.current = true;
        }
      } catch (err) {
        console.error('Error loading notification history:', err);
        if (isMounted) {
          const cached = loadLocalCache(user.id);
          setNotifications(cached);
          initialFetchDoneRef.current = true;
        }
      }
    }

    loadUserNotifications();

    return () => {
      isMounted = false;
    };
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

  // Dispatch a notification (audio, haptics, toast, browser push, state, and DB persistence)
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

    // 5. Update notifications state and local cache
    setNotifications((prev) => {
      const updated = [newNotification, ...prev.filter((n) => n.id !== newNotification.id)].slice(0, 50);
      if (user?.id) saveLocalCache(user.id, updated);
      return updated;
    });

    // 6. Persist to backend database in Supabase
    if (user?.id) {
      supabase.from('user_notifications').insert({
        id: newNotification.id,
        user_id: user.id,
        order_id: orderId,
        order_number: orderNumber,
        status,
        title,
        message,
        read: false,
        created_at: new Date(newNotification.timestamp).toISOString(),
      }).then(({ error }) => {
        if (error) {
          console.warn('Could not persist notification to user_notifications table:', error.message);
        }
      });
    }
  }, [user?.id, sendBrowserNotification]);

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
      if (user?.id) saveLocalCache(user.id, updated);
      return updated;
    });

    if (user?.id) {
      addToStorageSet(`${STORAGE_PREFIX}read_${user.id}`, id);
      supabase
        .from('user_notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('user_id', user.id)
        .then(() => {});
    }
  }, [user?.id]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      if (user?.id) {
        saveLocalCache(user.id, updated);
        prev.forEach((n) => addToStorageSet(`${STORAGE_PREFIX}read_${user.id}`, n.id));
      }
      return updated;
    });

    if (user?.id) {
      supabase
        .from('user_notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false)
        .then(() => {});
    }
  }, [user?.id]);

  // Delete a single notification
  const deleteNotification = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      if (user?.id) saveLocalCache(user.id, updated);
      return updated;
    });

    if (user?.id) {
      addToStorageSet(`${STORAGE_PREFIX}deleted_${user.id}`, id);
      supabase
        .from('user_notifications')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)
        .then(() => {});
    }
  }, [user?.id]);

  // Clear all notifications
  const clearAll = useCallback(() => {
    if (user?.id) {
      notifications.forEach((n) => addToStorageSet(`${STORAGE_PREFIX}deleted_${user.id}`, n.id));
      try {
        localStorage.removeItem(`${STORAGE_PREFIX}${user.id}`);
      } catch {
        // Ignore storage errors
      }
      supabase
        .from('user_notifications')
        .delete()
        .eq('user_id', user.id)
        .then(() => {});
    }
    setNotifications([]);
  }, [user?.id, notifications]);

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
        deleteNotification,
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
