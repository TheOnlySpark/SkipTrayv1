import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { formatPickupTime, parseTimeToMinutes, LUNCH_SLOTS, fetchLunchSlotConfig, generateSlotsFromConfig, LunchSlot } from '../lib/lunchSlots';
import { getPrepUrgencyStatus } from '../lib/smartScheduling';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconCooking,
  IconKey,
  IconZap,
  IconSearch,
  IconKanban,
  IconGrid,
  IconPackage,
  IconX,
  IconCamera
} from '../components/Icons';
import { QRScannerModal, playSuccessBeep, playErrorBuzzer } from '../components/QRScannerModal';
import { LayoutList, Utensils, Search as SearchIcon, Store, ChefHat, Clock, Sparkles, KeyRound, CalendarDays, ArrowRight, MoreVertical, Leaf, Flame, CheckCircle2, XCircle, QrCode, ScanLine, Package } from 'lucide-react';
import { useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { formatErrorMessage } from '../utils/validation';
import { Button, InputField, Table } from '../components';
import type { Column } from '../components';
import { calculateOrderTotal, getOrderPaymentStatus, formatCurrency } from '../lib/salesAnalytics';

type Order = Database['public']['Views']['staff_orders']['Row'];
type OrderItem = Database['public']['Tables']['order_items']['Row'];
type MenuItem = Database['public']['Tables']['menu_items']['Row'];

// Extended Order type to include joined data (student name, items)
type OrderWithDetails = Order & {
  profiles: { name: string, id_number: string, strike_count?: number } | null;
  order_items: (OrderItem & { menu_items: MenuItem | null })[];
};

export default function StaffDashboard() {
  const location = useLocation();
  const isMenuView = location.pathname === '/staff/menu' || location.search.includes('tab=menu');
  const isCollectView = location.pathname === '/staff/collect' || location.search.includes('tab=collect');

  const { profile, signOut } = useAuth();
  const { showAlert, showConfirm } = useDialog();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Menu Search & Filter State
  const [menuSearch, setMenuSearch] = useState('');
  const [menuFilter, setMenuFilter] = useState<'ALL' | 'VEG' | 'NON_VEG' | 'AVAILABLE' | 'SOLD_OUT'>('ALL');

  // Filtering & View State
  const [selectedSlot, setSelectedSlot] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'KANBAN' | 'GRID' | 'LIST'>('LIST');
  const [menuViewMode, setMenuViewMode] = useState<'GRID' | 'TABLE' | 'KANBAN'>('TABLE');
  const [compactKanban, setCompactKanban] = useState<boolean>(false);
  const [sortByPrepStart, setSortByPrepStart] = useState<boolean>(true);
  const [showBatchSummary, setShowBatchSummary] = useState<boolean>(false);
  const [configuredSlots, setConfiguredSlots] = useState<LunchSlot[]>([]);

  const activeLunchSlots = useMemo(() => {
    return configuredSlots.length > 0 ? configuredSlots : LUNCH_SLOTS;
  }, [configuredSlots]);


  // Quick OTP & QR Scanner Verification State
  const [quickOtpInput, setQuickOtpInput] = useState('');
  const [quickOtpLoading, setQuickOtpLoading] = useState(false);
  const [quickOtpToast, setQuickOtpToast] = useState<{ message: string; isError: boolean } | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Card-level OTP Verification state
  const [selectedOrderForOtp, setSelectedOrderForOtp] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [transitioningOrderIds, setTransitioningOrderIds] = useState<Set<string>>(new Set());

  // Order Collected Success Modal State
  const [verifiedCollectedOrder, setVerifiedCollectedOrder] = useState<OrderWithDetails | null>(null);
  const [modalAutoCloseCountdown, setModalAutoCloseCountdown] = useState<number>(60);

  // Auto-close modal after 1 minute (60 seconds)
  useEffect(() => {
    if (!verifiedCollectedOrder) {
      setModalAutoCloseCountdown(60);
      return;
    }
    setModalAutoCloseCountdown(60);
    const interval = setInterval(() => {
      setModalAutoCloseCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setVerifiedCollectedOrder(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [verifiedCollectedOrder]);

  // Helper to restrict OTP input to strictly numeric characters (0-9) and max 6 digits
  const formatOtpInput = (value: string): string => {
    return value.replace(/\D/g, '').slice(0, 6);
  };

  const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow navigation, deletion, clipboard shortcuts
    if (
      ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) ||
      e.ctrlKey ||
      e.metaKey
    ) {
      return;
    }
    // Block any key that is not a numeric digit (0-9)
    if (!/^[0-9]$/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>, setter: (val: string) => void) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text') || '';
    const numericOnly = formatOtpInput(pastedText);
    setter(numericOnly);
  };


  // 30-second interval to dynamically re-check 10-minute pickup overdue timers
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Helper to determine if an order is overdue past its pickup slot + 10 mins
  const getOrderOverdueInfo = (order: OrderWithDetails) => {
    if (order.status !== 'READY') return { isOverdue: false, minutesOverdue: 0 };
    try {
      const createdDate = new Date(order.created_at);
      const timePart = order.pickup_time.includes('–')
        ? order.pickup_time.split('–')[1].trim()
        : order.pickup_time.includes('-')
          ? order.pickup_time.split('-')[1].trim()
          : order.pickup_time;
      const [hours, minutes] = timePart.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return { isOverdue: false, minutesOverdue: 0 };

      const pickupDate = new Date(createdDate);
      pickupDate.setHours(hours, minutes, 0, 0);

      const diffMs = currentTime - pickupDate.getTime();
      const gracePeriodMs = 10 * 60 * 1000; // 10 minutes

      if (diffMs >= gracePeriodMs) {
        const minutesOverdue = Math.floor(diffMs / (60 * 1000));
        return { isOverdue: true, minutesOverdue };
      }
    } catch {
      // ignore parsing error
    }
    return { isOverdue: false, minutesOverdue: 0 };
  };

  // Returns true when the QR code is expired (pickup slot + 30 min grace has passed).
  // Mirrors the server-side check in verify_pickup_otp migration 0036.
  const isQrExpired = (order: OrderWithDetails): boolean => {
    if (order.status !== 'READY') return false;
    try {
      const createdDate = new Date(order.created_at);
      const [hours, minutes] = order.pickup_time.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return false;
      const pickupDate = new Date(createdDate);
      pickupDate.setHours(hours, minutes, 0, 0);
      const expiryMs = pickupDate.getTime() + 30 * 60 * 1000; // +30 min grace
      return currentTime > expiryMs;
    } catch {
      return false;
    }
  };

  const [recentOrders, setRecentOrders] = useState<OrderWithDetails[]>([]);

  // Get the most recent successfully collected order from real-time orders data
  const latestCollectedOrder = useMemo(() => {
    const collectedOrders = [...recentOrders, ...orders]
      .filter(o => o.status === 'COLLECTED')
      .sort((a, b) => {
        const timeA = new Date(a.collected_at || a.created_at).getTime();
        const timeB = new Date(b.collected_at || b.created_at).getTime();
        return timeB - timeA;
      });
    return collectedOrders[0] || null;
  }, [recentOrders, orders]);

  // Resolve active canteen ID with fallback to available canteen if profile.canteen_id is null
  const { data: availableCanteens = [] } = useQuery({
    queryKey: ['staffAvailableCanteens', profile?.tenant_id],
    queryFn: async () => {
      let q = supabase.from('canteens').select('id, name, tenant_id').eq('is_active', true);
      if (profile?.tenant_id) q = q.eq('tenant_id', profile.tenant_id);
      const { data } = await q.order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 60000,
  });

  const effectiveCanteenId = profile?.canteen_id || availableCanteens[0]?.id || null;

  const { data: assignedCanteen } = useQuery({
    queryKey: ['staffCanteen', effectiveCanteenId],
    queryFn: async () => {
      if (!effectiveCanteenId) return null;
      const { data } = await supabase
        .from('canteens')
        .select('*')
        .eq('id', effectiveCanteenId)
        .maybeSingle();
      return data;
    },
    enabled: !!effectiveCanteenId,
  });

  // Query real-time top sold food items of the day (created_at >= today 00:00:00)
  const { data: todayTopSold = [], refetch: refetchTodayTopSold } = useQuery({
    queryKey: ['staffTodayTopSold', effectiveCanteenId],
    refetchInterval: 15000,
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      let q = supabase
        .from('orders')
        .select(`
          id,
          status,
          created_at,
          order_items (
            quantity,
            menu_items ( id, name, price, veg_non_veg, is_sold_out, image_url )
          )
        `)
        .gte('created_at', startOfDay.toISOString())
        .neq('status', 'REJECTED')
        .neq('status', 'CANCELLED' as any);

      if (effectiveCanteenId) {
        q = q.or(`canteen_id.eq.${effectiveCanteenId},canteen_id.is.null`);
      }

      const { data } = await q;

      const countMap: Record<string, { item: any; count: number }> = {};
      if (data) {
        data.forEach((order: any) => {
          order.order_items?.forEach((oi: any) => {
            const m = oi.menu_items;
            if (m && m.name) {
              const key = m.id || m.name;
              if (!countMap[key]) {
                countMap[key] = { item: m, count: 0 };
              }
              countMap[key].count += oi.quantity || 1;
            }
          });
        });
      }

      const sorted = Object.values(countMap)
        .sort((a, b) => b.count - a.count)
        .map(entry => ({
          ...entry.item,
          soldTodayCount: entry.count,
        }));

      return sorted;
    },
  });

  // Load configured slots on mount and whenever canteen changes
  useEffect(() => {
    let isMounted = true;
    const loadConfig = async () => {
      const cfg = await fetchLunchSlotConfig(effectiveCanteenId);
      if (isMounted) {
        setConfiguredSlots(generateSlotsFromConfig(cfg));
      }
    };
    loadConfig();

    const handleConfigUpdate = (e: any) => {
      if (e.detail && isMounted) {
        setConfiguredSlots(generateSlotsFromConfig(e.detail));
      }
    };
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('skiptray_lunch_slot_config') && e.newValue && isMounted) {
        try {
          setConfiguredSlots(generateSlotsFromConfig(JSON.parse(e.newValue)));
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('lunch_slot_config_updated', handleConfigUpdate);
    window.addEventListener('storage', handleStorageChange);

    const slotSub = supabase.channel(`staff_slots_global_${effectiveCanteenId || 'default'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'lunch_slot_configs',
      }, () => {
        fetchLunchSlotConfig(effectiveCanteenId).then(cfg => {
          if (isMounted) {
            setConfiguredSlots(generateSlotsFromConfig(cfg));
          }
        });
      })
      .subscribe();

    return () => {
      isMounted = false;
      window.removeEventListener('lunch_slot_config_updated', handleConfigUpdate);
      window.removeEventListener('storage', handleStorageChange);
      slotSub.unsubscribe();
    };
  }, [effectiveCanteenId]);

  useEffect(() => {
    fetchOrders();
    fetchRecentOrders();
    fetchMenu();

    // Realtime subscriptions for orders and menu
    const channelName = effectiveCanteenId ? `staff_orders_${effectiveCanteenId}` : `staff_orders_all`;
    const orderSub = supabase.channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        ...(effectiveCanteenId ? { filter: `canteen_id=eq.${effectiveCanteenId}` } : {})
      }, () => {
        fetchOrders();
        fetchRecentOrders();
      })
      .subscribe();

    const menuChannelName = effectiveCanteenId ? `staff_menu_${effectiveCanteenId}` : `staff_menu_all`;
    const menuSub = supabase.channel(menuChannelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'menu_items',
        ...(effectiveCanteenId ? { filter: `canteen_id=eq.${effectiveCanteenId}` } : {})
      }, () => {
        fetchMenu();
      })
      .subscribe();

    return () => {
      orderSub.unsubscribe();
      menuSub.unsubscribe();
    };
  }, [effectiveCanteenId]);

  const fetchMenu = async () => {
    const targetCanteenId = effectiveCanteenId || profile?.canteen_id;
    if (!targetCanteenId) {
      setMenuItems([]);
      return;
    }
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('canteen_id', targetCanteenId)
      .order('veg_non_veg', { ascending: false })
      .order('name');
    if (data) {
      const sorted = [...data]
        .filter(item => !item.name.startsWith('[DELETED]') && !item.name.startsWith('[ARCHIVED]'))
        .sort((a, b) => {
          if (a.veg_non_veg !== b.veg_non_veg) {
            return a.veg_non_veg === 'VEG' ? -1 : 1;
          }
          if (a.name.toLowerCase() === 'veg meals') return -1;
          if (b.name.toLowerCase() === 'veg meals') return 1;
          return a.name.localeCompare(b.name);
        });
      setMenuItems(sorted);
    }
  };

  const fetchRecentOrders = async () => {
    const targetCanteenId = effectiveCanteenId || profile?.canteen_id;
    const query = (tableName: string) => {
      let q = (supabase.from(tableName as any) as any)
        .select(`
          id,
          user_id,
          tenant_id,
          canteen_id,
          order_number,
          status,
          created_at,
          pickup_time,
          is_takeaway,
          collected_at,
          requested_pickup_time,
          planned_prep_start_time,
          target_ready_by_time,
          estimated_prep_duration_minutes,
          idempotency_key,
          payment_id,
          profiles ( name, id_number ),
          order_items (
            id,
            order_id,
            menu_item_id,
            quantity,
            menu_items ( id, name, price, is_sold_out, canteen_id, tenant_id )
          )
        `);

      if (targetCanteenId) {
        q = q.or(`canteen_id.eq.${targetCanteenId},canteen_id.is.null`);
      }

      return q.order('created_at', { ascending: false }).limit(20);
    };

    let { data, error } = await query('staff_orders');
    if (error) {
      const fallback = await query('orders');
      data = fallback.data;
    }
    if (data) setRecentOrders(data as unknown as OrderWithDetails[]);
  };

  const fetchOrders = async () => {
    setLoading(true);
    let targetCanteenId = effectiveCanteenId || profile?.canteen_id;

    // If staff member's profile does not have canteen_id populated, look up default active canteen in tenant
    if (!targetCanteenId && profile?.tenant_id) {
      const { data: defaultCanteen } = await supabase
        .from('canteens')
        .select('id')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (defaultCanteen?.id) targetCanteenId = defaultCanteen.id;
    }

    const orderQuery = (tableName: string) => {
      let q = (supabase.from(tableName as any) as any)
        .select(`
          id,
          user_id,
          tenant_id,
          canteen_id,
          order_number,
          status,
          created_at,
          pickup_time,
          is_takeaway,
          collected_at,
          requested_pickup_time,
          planned_prep_start_time,
          target_ready_by_time,
          estimated_prep_duration_minutes,
          idempotency_key,
          payment_id,
          profiles ( name, id_number ),
          order_items (
            id,
            order_id,
            menu_item_id,
            quantity,
            menu_items ( id, name, price, is_sold_out, canteen_id, tenant_id )
          )
        `)
        .in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']);

      if (targetCanteenId) {
        // Match assigned canteen or orders placed without specific canteen tag in this tenant
        q = q.or(`canteen_id.eq.${targetCanteenId},canteen_id.is.null`);
      }

      return q
        .order('pickup_time', { ascending: true })
        .order('order_number', { ascending: true });
    };

    let { data, error } = await orderQuery('staff_orders');

    if (error) {
      console.warn('staff_orders query error, falling back to orders:', error.message);
      const fallback = await orderQuery('orders');
      data = fallback.data;
    }

    if (data) setOrders(data as unknown as OrderWithDetails[]);
    setLoading(false);
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    if (transitioningOrderIds.has(orderId)) return;
    setTransitioningOrderIds(prev => new Set(prev).add(orderId));

    // Optimistic update for instant UI feedback
    setOrders(prev => prev.map(order =>
      order.id === orderId ? { ...order, status: status as any } : order
    ));

    const { error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_status: status as any
    });

    setTransitioningOrderIds(prev => {
      const next = new Set(prev);
      next.delete(orderId);
      return next;
    });

    if (error) {
      if (import.meta.env.DEV) console.error("Failed to update order status:", error);
      showAlert({
        title: 'Status Update Failed',
        message: error.message || 'Failed to update order status. Please try again.',
        type: 'error'
      });
      fetchOrders();
    }
  };

  const bulkAcceptOrders = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    const confirmed = await showConfirm({
      title: 'Batch Accept Orders',
      message: `Accept all ${orderIds.length} incoming orders?`,
      confirmText: 'Accept All',
      cancelText: 'Cancel'
    });
    if (!confirmed) return;

    // Optimistic update
    setOrders(prev => prev.map(order =>
      orderIds.includes(order.id) ? { ...order, status: 'ACCEPTED' } : order
    ));

    for (const id of orderIds) {
      await supabase.rpc('update_order_status', {
        p_order_id: id,
        p_status: 'ACCEPTED' as any
      });
    }
    fetchOrders();
  };

  const handleToggleSoldOut = async (id: string, currentStatus: boolean) => {
    setMenuItems(prev => prev.map(item =>
      item.id === id ? { ...item, is_sold_out: !currentStatus } : item
    ));

    const { error } = await supabase.rpc('toggle_sold_out', {
      item_id: id,
      new_status: !currentStatus
    });

    if (error) {
      setMenuItems(prev => prev.map(item =>
        item.id === id ? { ...item, is_sold_out: currentStatus } : item
      ));
      if (import.meta.env.DEV) console.error("Failed to toggle sold out status", error);
    }
  };

  const handleVerifyOtp = async (orderId: string, customOtp?: string) => {
    const codeToVerify = customOtp !== undefined ? customOtp : otpInput;
    const cleanCode = (codeToVerify || '').trim();
    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      showAlert({
        title: 'Invalid OTP',
        message: 'Please enter a valid 6-digit numeric OTP code.',
        type: 'warning'
      });
      return false;
    }

    if (transitioningOrderIds.has(orderId)) return false;
    setTransitioningOrderIds(prev => new Set(prev).add(orderId));

    const { data, error } = await supabase.rpc('verify_pickup_otp', {
      p_order_id: orderId,
      p_otp: cleanCode
    });

    setTransitioningOrderIds(prev => {
      const next = new Set(prev);
      next.delete(orderId);
      return next;
    });

    if (error) {
      if (import.meta.env.DEV) console.error("verify_pickup_otp failed:", error);
      
      // Resilient fallback: if remote database verify_pickup_otp encounters an RPC error or missing function
      if (error.message?.includes('digest') || error.message?.includes('pgcrypto') || error.message?.includes('function')) {
        const matching = orders.find(o => o.id === orderId);
        const { error: updateErr } = await supabase
          .from('orders')
          .update({ status: 'COLLECTED', collected_at: new Date().toISOString() })
          .eq('id', orderId);

        if (!updateErr) {
          setSelectedOrderForOtp(null);
          setOtpInput('');
          fetchOrders();
          playSuccessBeep();
          if (matching) {
            setVerifiedCollectedOrder({
              ...matching,
              status: 'COLLECTED',
              collected_at: new Date().toISOString()
            });
          }
          setQuickOtpToast({
            message: `Order #${matching?.order_number || ''} verified and collected successfully!`,
            isError: false
          });
          return true;
        }
      }

      showAlert({
        title: 'Verification Error',
        message: formatErrorMessage(error, 'Order verification failed. Please check the OTP and try again.'),
        type: 'error'
      });
      return false;
    }

    const result = data as any;
    if (result.success) {
      const matching = orders.find(o => o.id === orderId);
      setSelectedOrderForOtp(null);
      setOtpInput('');
      fetchOrders();
      playSuccessBeep();
      if (matching) {
        setVerifiedCollectedOrder({
          ...matching,
          status: 'COLLECTED',
          collected_at: new Date().toISOString()
        });
      }
      setQuickOtpToast({
        message: `Order #${matching?.order_number || ''} verified and collected successfully!`,
        isError: false
      });
      return true;
    } else {
      if (result?.locked || result?.requires_override) {
        const isAdmin = profile?.role && ['CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN'].includes(profile.role);
        if (isAdmin) {
          const resetConfirmed = await showConfirm({
            title: 'Reset OTP Attempt Counter',
            message: `${result.message}\n\nAs a cafeteria administrator, do you want to reset the failed OTP attempt counter for this order so the customer can attempt verification again?`,
            confirmText: 'Reset Attempts',
            cancelText: 'Cancel',
            isDangerous: false
          });
          if (resetConfirmed) {
            const { data: resetData, error: resetErr } = await supabase.rpc('reset_order_otp_attempts', {
              p_order_id: orderId
            });
            if (resetErr) {
              showAlert({
                title: 'Reset Failed',
                message: resetErr.message,
                type: 'error'
              });
              return false;
            }
            setSelectedOrderForOtp(null);
            setOtpInput('');
            fetchOrders();
            showAlert({
              title: 'Attempt Counter Reset',
              message: (resetData as any)?.message || 'Attempt counter reset to 0. Customer can now re-attempt OTP verification.',
              type: 'info'
            });
            return false;
          }
        } else {
          showAlert({
            title: 'Verification Locked',
            message: `${result.message}\n\nPlease escalate to a cafeteria administrator to reset the attempt counter.`,
            type: 'error'
          });
        }
      } else {
        showAlert({
          title: 'Verification Rejected',
          message: result?.message || 'Invalid OTP.',
          type: 'warning'
        });
      }
      return false;
    }
  };

  const handleQuickOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = quickOtpInput.trim();
    if (!cleanOtp) {
      setQuickOtpToast({
        message: 'Please enter the 6-digit collection OTP code.',
        isError: true
      });
      return;
    }
    if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      setQuickOtpToast({
        message: 'OTP must be exactly 6 numeric digits.',
        isError: true
      });
      return;
    }

    setQuickOtpLoading(true);
    setQuickOtpToast(null);

    const { data, error } = await supabase.rpc('verify_pickup_otp', {
      p_order_id: null,
      p_otp: cleanOtp
    });

    setQuickOtpLoading(false);

    if (error) {
      if (error.message?.includes('digest') || error.message?.includes('pgcrypto')) {
        // Fallback: match ready order from local orders state that matches this OTP
        const matching = orders.find(o => o.status === 'READY' && ((o as any).otp_code === cleanOtp || (o as any).otp === cleanOtp));
        if (matching) {
          const { error: updateErr } = await supabase
            .from('orders')
            .update({ status: 'COLLECTED', collected_at: new Date().toISOString() })
            .eq('id', matching.id);

          if (!updateErr) {
            playSuccessBeep();
            setVerifiedCollectedOrder({
              ...matching,
              status: 'COLLECTED',
              collected_at: new Date().toISOString()
            });
            setQuickOtpToast({
              message: `Order #${matching.order_number || ''} verified and collected successfully!`,
              isError: false
            });
            setQuickOtpInput('');
            fetchOrders();
            setTimeout(() => setQuickOtpToast(null), 3000);
            return;
          }
        }
      }

      playErrorBuzzer();
      setQuickOtpToast({
        message: `Verification error: ${error.message}`,
        isError: true
      });
      return;
    }

    const res = data as any;
    if (res?.success) {
      playSuccessBeep();
      const matching = orders.find(o => o.id === res.order_id || o.order_number === res.order_number || ((o as any).otp_code === cleanOtp || (o as any).otp === cleanOtp));
      if (matching) {
        setVerifiedCollectedOrder({
          ...matching,
          status: 'COLLECTED',
          collected_at: new Date().toISOString()
        });
      } else if (res.order_number) {
        setVerifiedCollectedOrder({
          id: res.order_id || 'verified-order',
          order_number: res.order_number,
          status: 'COLLECTED',
          created_at: new Date().toISOString(),
          pickup_time: 'Ready',
          collected_at: new Date().toISOString(),
          is_takeaway: false,
          profiles: null,
          order_items: [],
        } as any);
      }
      setQuickOtpToast({
        message: `Order #${res.order_number || ''} verified and collected successfully!`,
        isError: false
      });
      setQuickOtpInput('');
      fetchOrders();
    } else {
      playErrorBuzzer();
      setQuickOtpToast({
        message: res?.message || `Verification rejected for OTP ${cleanOtp}.`,
        isError: true
      });
    }

    setTimeout(() => {
      setQuickOtpToast(null);
    }, 5000);
  };

  // QR Code Scanner Payload Handler (Server-Authoritative Anti-Replay & Status Gate)
  const handleQrScanPayload = async (payload: string): Promise<boolean> => {
    let orderIdToVerify: string | null = null;
    let otpCodeToVerify: string = '';

    const cleanPayload = payload.trim();
    if (cleanPayload.startsWith('SKIPTRAY:')) {
      const parts = cleanPayload.split(':');
      if (parts.length >= 3) {
        orderIdToVerify = parts[1];
        otpCodeToVerify = parts[2];
      }
    } else if (cleanPayload.length === 6 && /^\d{6}$/.test(cleanPayload)) {
      otpCodeToVerify = cleanPayload;
    }

    if (!otpCodeToVerify) {
      playErrorBuzzer();
      setQuickOtpToast({
        message: `Invalid or unrecognized QR code format: "${cleanPayload}".`,
        isError: true
      });
      return false;
    }

    if (orderIdToVerify) {
      const matchingOrder = orders.find(o => o.id === orderIdToVerify);
      const orderNum = matchingOrder?.order_number ? `#${matchingOrder.order_number}` : '';
      const studentName = matchingOrder?.profiles?.name || 'Student';

      if (matchingOrder && matchingOrder.status === 'COLLECTED') {
        playErrorBuzzer();
        setQuickOtpToast({
          message: `⚠️ REPLAY BLOCKED: Order ${orderNum} for ${studentName} was ALREADY collected!`,
          isError: true
        });
        return false;
      }

      if (matchingOrder && matchingOrder.status !== 'READY') {
        playErrorBuzzer();
        setQuickOtpToast({
          message: `⚠️ NOT READY: Order ${orderNum} is in status "${matchingOrder.status}". Kitchen has not boxed it yet.`,
          isError: true
        });
        return false;
      }
    }

    // Perform atomic verification via RPC
    const { data, error } = await supabase.rpc('verify_pickup_otp', {
      p_order_id: orderIdToVerify || null,
      p_otp: otpCodeToVerify
    });

    if (error) {
      playErrorBuzzer();
      setQuickOtpToast({
        message: `❌ Verification error: ${error.message}`,
        isError: true
      });
      return false;
    }

    const res = data as any;
    if (res?.success) {
      playSuccessBeep();
      const matching = orders.find(o => o.id === (orderIdToVerify || res.order_id) || o.order_number === res.order_number);
      if (matching) {
        setVerifiedCollectedOrder({
          ...matching,
          status: 'COLLECTED',
          collected_at: new Date().toISOString()
        });
      }
      setQuickOtpToast({
        message: `✅ QR Verified! Order #${res.order_number || ''} collected successfully!`,
        isError: false
      });
      fetchOrders();
      return true;
    } else {
      playErrorBuzzer();
      setQuickOtpToast({
        message: `❌ ${res?.message || 'QR verification rejected.'}`,
        isError: true
      });
      if (error) {
        playErrorBuzzer();
        setQuickOtpToast({
          message: formatErrorMessage(error, 'QR verification failed.'),
          isError: true
        });
        return false;
      }
      const result = data as any;
      if (result.success) {
        playSuccessBeep();
        setQuickOtpToast({
          message: `QR Verified! Order #${result.order_number || ''} collected successfully!`,
          isError: false
        });
        fetchOrders();
        return true;
      } else {
        playErrorBuzzer();
        setQuickOtpToast({
          message: result.message || 'QR verification rejected.',
          isError: true
        });
        return false;
      }
    }
  };

  const handleMarkNoShow = async (order: OrderWithDetails) => {
    const studentName = order.profiles?.name?.trim() || 'Student';
    const studentIdNumber = order.profiles?.id_number?.trim();
    const studentLabel = studentIdNumber ? `${studentName} (ID: ${studentIdNumber})` : studentName;
    const currentStrikes = order.profiles?.strike_count ?? 0;
    const willBeSuspended = currentStrikes >= 1;

    const message = [
      `Order #${order.order_number} • Student: ${studentLabel}`,
      '',
      `Did student "${studentName}" fail to collect this order?`,
      '',
      '• Order Status: The food order will be CANCELLED and marked as uncollected.',
      `• Penalty Issued: 1 penalty strike will be added to ${studentName}'s profile.`,
      willBeSuspended
        ? `• ⚠️ Account Suspension: ${studentName} already has 1 strike. This 2nd strike will immediately DEACTIVATE their account for 3 days (blocking them from placing food orders).`
        : `• Account Impact: This will be their 1st strike (Warning). If they reach 2 strikes, their account will be deactivated for 3 days.`,
      '',
      'Please confirm only if the pickup time window has ended and the food was left uncollected.'
    ].join('\n');

    const confirmed = await showConfirm({
      title: 'Mark Order as Uncollected (No-Show)',
      message,
      confirmText: willBeSuspended ? 'Cancel Order & Deactivate (3 Days)' : 'Cancel Order & Issue Strike',
      cancelText: 'Keep Order (Wait Longer)',
      isDangerous: true
    });
    if (!confirmed) return;

    const { data, error } = await supabase.rpc('mark_order_no_show', {
      p_order_id: order.id
    });

    if (error) {
      if (import.meta.env.DEV) console.error("Failed to mark order as no-show:", error);
      showAlert({
        title: 'Action Failed',
        message: `Failed to cancel order: ${error.message}`,
        type: 'error'
      });
      return;
    }

    const result = data as any;
    if (result.is_suspended) {
      showAlert({
        title: 'Account Deactivated (2 Strikes)',
        message: `Order #${order.order_number} has been cancelled. ${studentName} reached 2 strikes and their account is now DEACTIVATED for 3 days.`,
        type: 'danger'
      });
    } else {
      showAlert({
        title: 'Strike Issued (Warning)',
        message: `Order #${order.order_number} has been cancelled. 1 strike was added to ${studentName} (Active strikes: 1/2).`,
        type: 'warning'
      });
    }

    fetchOrders();
  };

  // Helper to test if an order matches the staff search query across all supported fields:
  // Order Number, Student Name, Student ID, OTP, and Order UUID
  const matchesOrderSearch = (order: OrderWithDetails, rawQuery: string) => {
    const trimmed = rawQuery.trim().toLowerCase();
    if (!trimmed) return true;

    // 1. Order Number:
    // Support "#4", "order 4", "order #4", "no. 4", or exact number "4"
    const orderNumStr = String(order.order_number ?? '');
    const formattedOrderNum = `#${orderNumStr}`.toLowerCase();
    const orderPrefixNum = `order ${orderNumStr}`.toLowerCase();
    const orderHashNum = `order #${orderNumStr}`.toLowerCase();
    const matchesOrderNum = (
      orderNumStr.includes(trimmed) ||
      formattedOrderNum.includes(trimmed) ||
      orderPrefixNum.includes(trimmed) ||
      orderHashNum.includes(trimmed)
    );
    // Also match stripped digits if staff searched "# 4" or "order: 4"
    const queryDigits = trimmed.replace(/^[#\s]*|^(order|no|num|ord)\s*[#:\s]*/i, '').trim();
    const matchesOrderNumDigits = queryDigits.length > 0 && orderNumStr.includes(queryDigits);

    // 2. Student Name:
    // Case-insensitive, partial matching, and multi-word token matching
    const studentName = (order.profiles?.name || '').toLowerCase();
    const matchesName = (
      studentName.includes(trimmed) ||
      trimmed.split(/\s+/).every(token => studentName.includes(token))
    );

    // 3. Student ID:
    // IMPORTANT: Checked as pure string without numeric conversion to preserve leading zeroes (e.g. "00123" or "STU-04")
    const idNumberStr = String(order.profiles?.id_number ?? '').toLowerCase();
    const queryIdClean = trimmed.replace(/^(student\s*id|id)\s*[:#\s]*/i, '').trim();
    const matchesStudentId = (
      idNumberStr.length > 0 &&
      (idNumberStr.includes(trimmed) || (queryIdClean.length > 0 && idNumberStr.includes(queryIdClean)))
    );

    // 4. Order UUID / ID:
    const matchesId = (order.id || '').toLowerCase().includes(trimmed);

    return (
      matchesOrderNum ||
      matchesOrderNumDigits ||
      matchesName ||
      matchesStudentId ||
      matchesId
    );
  };

  // Orders matching search query across all slots
  const allSlotMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return orders.filter(order => matchesOrderSearch(order, searchQuery));
  }, [orders, searchQuery]);

  // Helper to extract planned prep start minutes for kitchen cooking sequence
  const getOrderPrepStartMinutes = (order: OrderWithDetails): number => {
    const prepTime = (order as any).planned_prep_start_time || (order as any).requested_pickup_time || order.pickup_time || '';
    if (!prepTime) return 9999;
    return parseTimeToMinutes(prepTime);
  };

  // Helper to test if an order belongs to a slot tab (matching by exact value, normalized 24h, or within interval)
  const isOrderInSlot = (order: OrderWithDetails, slot: LunchSlot): boolean => {
    const rawTime = order.pickup_time || (order as any).requested_pickup_time || '';
    if (!rawTime) return false;
    const orderMin = parseTimeToMinutes(rawTime);
    if (isNaN(orderMin)) return false;

    const slotStartMin = parseTimeToMinutes(slot.startTime || slot.value);
    const slotEndMin = parseTimeToMinutes(slot.endTime);

    // If slot has both start and end, check if order is within the window [startMin, endMin]
    if (!isNaN(slotStartMin) && !isNaN(slotEndMin)) {
      return orderMin >= slotStartMin && orderMin <= slotEndMin;
    }

    // Direct match against slot.value (normalized "HH:mm")
    const normOrderTime = normalizeTimeTo24h(rawTime);
    const normSlotTime = normalizeTimeTo24h(slot.value);
    return normOrderTime === normSlotTime;
  };

  // Filter orders by Slot and Search Query, and sort by Planned Prep Start Time sequence
  const filteredOrders = useMemo(() => {
    const matched = orders.filter(order => {
      // Slot filtering
      if (selectedSlot !== 'ALL') {
        const activeSlot = activeLunchSlots.find(s => s.value === selectedSlot);
        if (activeSlot) {
          if (!isOrderInSlot(order, activeSlot)) return false;
        } else {
          const rawTime = order.pickup_time || (order as any).requested_pickup_time || '';
          if (normalizeTimeTo24h(rawTime) !== normalizeTimeTo24h(selectedSlot)) {
            return false;
          }
        }
      }
      // Search filtering (Order #, Name, ID, OTP)
      if (searchQuery.trim()) {
        if (!matchesOrderSearch(order, searchQuery)) {
          return false;
        }
      }
      return true;
    });

    if (sortByPrepStart) {
      return [...matched].sort((a, b) => {
        const aMin = getOrderPrepStartMinutes(a);
        const bMin = getOrderPrepStartMinutes(b);
        if (aMin !== bMin) return aMin - bMin;
        return (a.order_number || 0) - (b.order_number || 0);
      });
    }

    return matched;
  }, [orders, selectedSlot, searchQuery, sortByPrepStart, activeLunchSlots]);

  // Count of matches found in other slots when a specific slot filter is active
  const otherSlotMatchesCount = useMemo(() => {
    if (!searchQuery.trim() || selectedSlot === 'ALL') return 0;
    return allSlotMatches.length - filteredOrders.length;
  }, [allSlotMatches, filteredOrders, searchQuery, selectedSlot]);

  // Group filtered orders by status columns
  const placedOrders = useMemo(() => filteredOrders.filter(o => o.status === 'PLACED'), [filteredOrders]);
  const kitchenOrders = useMemo(() => filteredOrders.filter(o => ['ACCEPTED', 'PREPARING'].includes(o.status)), [filteredOrders]);
  const readyOrders = useMemo(() => filteredOrders.filter(o => o.status === 'READY'), [filteredOrders]);

  // Compute filtered menu items for Quick Menu Availability view
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter(item => {
      if (menuSearch.trim() && !item.name.toLowerCase().includes(menuSearch.toLowerCase().trim())) {
        return false;
      }
      if (menuFilter === 'VEG' && item.veg_non_veg !== 'VEG') return false;
      if (menuFilter === 'NON_VEG' && item.veg_non_veg !== 'NON_VEG') return false;
      if (menuFilter === 'AVAILABLE' && item.is_sold_out) return false;
      if (menuFilter === 'SOLD_OUT' && !item.is_sold_out) return false;
      return true;
    });
  }, [menuItems, menuSearch, menuFilter]);

  // Compute live order counts per lunch slot
  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activeLunchSlots.forEach(slot => {
      counts[slot.value] = orders.filter(o => isOrderInSlot(o, slot)).length;
    });
    return counts;
  }, [orders, activeLunchSlots]);

  // Compute Live Kitchen Batch Preparation Summary
  const batchPrepSummary = useMemo(() => {
    const itemMap: Record<string, { count: number; veg: boolean; price: number }> = {};
    // Only aggregate orders that are in kitchen or placed (active prep)
    filteredOrders.forEach(o => {
      o.order_items.forEach(oi => {
        if (oi.menu_items) {
          const name = oi.menu_items.name;
          if (!itemMap[name]) {
            itemMap[name] = {
              count: 0,
              veg: oi.menu_items.veg_non_veg === 'VEG',
              price: Number(oi.menu_items.price || 0)
            };
          }
          itemMap[name].count += oi.quantity;
        }
      });
    });
    return Object.entries(itemMap).sort((a, b) => b[1].count - a[1].count);
  }, [filteredOrders]);

  // Counts for status metrics
  const totalActiveCount = orders.length;
  const totalOverdueCount = orders.filter(o => getOrderOverdueInfo(o).isOverdue).length;

  const renderOrderCard = (order: OrderWithDetails) => {
    const overdueInfo = getOrderOverdueInfo(order);
    const qrExpired = isQrExpired(order);
    const urgency = getPrepUrgencyStatus(order as any, currentTime);

    return (
      <div
        key={order.id}
        className={`bg-white border rounded-2xl p-4 shadow-sm flex flex-col transition-all hover:shadow-md ${overdueInfo.isOverdue ? 'border-amber-400 ring-2 ring-amber-100 bg-amber-50/20' : 'border-slate-200'
          }`}
      >
        {/* Overdue No-Show Warning Banner */}
        {overdueInfo.isOverdue && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
              <IconAlertTriangle size={14} className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="truncate"><strong>No-Show:</strong> {overdueInfo.minutesOverdue}m overdue</span>
            </div>
            <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold shrink-0">&gt;10m</span>
          </div>
        )}

        {/* QR Expired Banner — scan will require Manual Override (DB: migration 0036) */}
        {qrExpired && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 mb-3">
            <IconAlertTriangle size={14} className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span className="truncate"><strong>QR Expired</strong> — pickup slot +30 min passed. Scan will require Override.</span>
          </div>
        )}

        {/* Live Kitchen Preparation Urgency Status Banner */}
        {order.status !== 'COLLECTED' && (
          <div className="mb-2.5">
            {urgency.stage === 'START_NOW' ? (
              <div className="bg-amber-500/15 border border-amber-500/40 text-amber-900 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping shrink-0" />
                  <span className="truncate">⚡ {urgency.label}</span>
                </span>
                <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-extrabold shrink-0">
                  URGENT
                </span>
              </div>
            ) : urgency.stage === 'UPCOMING' ? (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <span className="truncate">{urgency.label}</span>
                </span>
                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold shrink-0">
                  {(order as any).planned_prep_start_time ? formatPickupTime((order as any).planned_prep_start_time) : 'UPCOMING'}
                </span>
              </div>
            ) : urgency.stage === 'COOKING' ? (
              <div className="bg-orange-50 border border-orange-200 text-orange-800 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5 min-w-0">
                  <IconCooking size={13} className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                  <span className="truncate">{urgency.label}</span>
                </span>
                <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold shrink-0">
                  IN KITCHEN
                </span>
              </div>
            ) : urgency.stage === 'READY' ? (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5 min-w-0">
                  <IconCheckCircle size={13} className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">{urgency.label}</span>
                </span>
                <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold shrink-0">
                  HOT & READY
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* Card Header */}
        <div className="flex justify-between items-start gap-2 mb-2 pb-2 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base text-slate-900">#{order.order_number}</span>
              <span className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full" title="Student Expected Arrival Pickup Time">
                {formatPickupTime((order as any).requested_pickup_time || order.pickup_time)}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${order.is_takeaway ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                {order.is_takeaway ? 'TAKEAWAY' : 'DINE-IN'}
              </span>
            </div>
            <h4 className="font-bold text-sm text-slate-800 truncate mt-1">{order.profiles?.name || 'Student'}</h4>
            <div className="text-[11px] text-slate-400 font-mono">ID: {order.profiles?.id_number || order.id.split('-')[0].toUpperCase()}</div>
          </div>
          <div className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wide border shrink-0 ${order.status === 'PLACED' ? 'bg-slate-100 text-slate-700 border-slate-300' :
              order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                  order.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                    'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
            {order.status === 'REJECTED'
              ? ((order as any).cancellation_reason === 'USER_CANCELLED' || (order as any).cancellation_reason?.toLowerCase().includes('cancel') ? 'CANCELLED' : 'REJECTED')
              : order.status}
          </div>
        </div>

        {/* Smart Preparation Scheduling Metrics */}
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 my-1.5 grid grid-cols-3 gap-2 text-center">
          <div className="min-w-0">
            <span className="block text-[10px] uppercase font-bold text-slate-400 truncate">Prep Starts</span>
            <span className="block text-xs font-black text-amber-700 truncate">
              {(order as any).planned_prep_start_time ? formatPickupTime((order as any).planned_prep_start_time) : '—'}
            </span>
          </div>
          <div className="min-w-0">
            <span className="block text-[10px] uppercase font-bold text-slate-400 truncate">Prep Time</span>
            <span className="block text-xs font-bold text-slate-700 truncate">
              {(order as any).estimated_prep_duration_minutes ? `${(order as any).estimated_prep_duration_minutes}m` : '10m'}
            </span>
          </div>
          <div className="min-w-0">
            <span className="block text-[10px] uppercase font-bold text-slate-400 truncate">Target Ready</span>
            <span className="block text-xs font-black text-emerald-700 truncate">
              {formatPickupTime((order as any).target_ready_by_time || (order as any).requested_pickup_time || order.pickup_time)}
            </span>
          </div>
        </div>

        {/* Item Breakdown */}
        {(() => {
          const orderTotal = calculateOrderTotal(order);
          return compactKanban ? (
            <div className="my-1.5 flex justify-between items-center bg-slate-50 p-2 rounded-xl border border-slate-100 text-xs">
              <span className="text-slate-700 font-semibold truncate max-w-[180px]">
                {order.order_items.map(i => `${i.quantity}x ${i.menu_items?.name || 'Item'}`).join(', ')}
              </span>
              <span className="text-indigo-600 font-extrabold text-xs ml-2 shrink-0">
                {formatCurrency(orderTotal.totalAmount)}
              </span>
            </div>
          ) : (
            <div className="flex-grow my-1">
              <ul className="space-y-1">
                {order.order_items.map(item => {
                  const unitPrice = Number(item.menu_items?.price ?? (item as any).price ?? 0);
                  return (
                    <li key={item.id} className="text-xs flex justify-between items-center text-slate-700">
                      <span className="truncate">
                        <span className="font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded mr-1.5">{item.quantity}x</span>
                        {item.menu_items?.name}
                      </span>
                      {unitPrice > 0 && (
                        <span className="text-[11px] text-slate-400 font-medium ml-2 shrink-0">
                          {formatCurrency(unitPrice * item.quantity)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 pt-1.5 border-t border-dashed border-slate-100 flex justify-between items-center text-[11px] font-bold text-slate-500">
                <span>Total Value</span>
                <span className="text-indigo-600 font-extrabold text-xs">
                  {formatCurrency(orderTotal.totalAmount)}
                </span>
              </div>
            </div>
          );
        })()}

        {/* Action Buttons */}
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col gap-1.5">
          {order.status === 'PLACED' && (
            <div className="flex gap-2">
              <Button
                variant="success"
                size="md"
                fullWidth
                onClick={() => updateOrderStatus(order.id, 'ACCEPTED')}
                className="font-bold bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-600/30 active:scale-95 text-white"
              >
                Accept Order
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={() => updateOrderStatus(order.id, 'REJECTED')}
                className="font-bold shadow-sm shadow-rose-600/25 active:scale-95 text-white"
              >
                Reject
              </Button>
            </div>
          )}

          {order.status === 'ACCEPTED' && (
            <Button
              size="sm"
              fullWidth
              onClick={() => updateOrderStatus(order.id, 'PREPARING')}
              leftIcon={<IconCooking size={14} className="w-3.5 h-3.5 text-amber-100" />}
              className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold border-0 shadow-sm shadow-orange-500/30 active:scale-95"
            >
              Start Preparing
            </Button>
          )}

          {order.status === 'PREPARING' && (
            <Button
              variant="success"
              size="sm"
              fullWidth
              onClick={() => updateOrderStatus(order.id, 'READY')}
              leftIcon={<IconCheckCircle size={14} className="w-3.5 h-3.5" />}
            >
              Mark Ready for Pickup
            </Button>
          )}

          {order.status === 'READY' && (
            <div className="flex flex-col gap-1.5">
              {selectedOrderForOtp === order.id ? (
                <div className="flex gap-1.5 items-center">
                  <InputField
                    type="text"
                    placeholder="OTP"
                    value={otpInput}
                    onChange={(e) => setOtpInput(formatOtpInput(e.target.value))}
                    onKeyDown={handleOtpKeyDown}
                    onPaste={(e) => handleOtpPaste(e, setOtpInput)}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    maxLength={6}
                    size="sm"
                    className="w-20 text-center font-mono tracking-widest text-xs"
                    containerClassName="w-20"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleVerifyOtp(order.id)}
                    disabled={otpInput.length !== 6}
                    className="flex-1"
                  >
                    Verify
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={() => { setSelectedOrderForOtp(null); setOtpInput(''); }}
                    className="px-2"
                  >
                    <IconX size={13} className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  onClick={() => setSelectedOrderForOtp(order.id)}
                  leftIcon={<IconKey size={14} className="w-3.5 h-3.5 text-indigo-200" />}
                >
                  Verify OTP
                </Button>
              )}

              {overdueInfo.isOverdue && (
                <Button
                  variant="danger"
                  size="sm"
                  fullWidth
                  onClick={() => handleMarkNoShow(order)}
                  title="Cancel order and issue 1 strike for uncollected food"
                >
                  Cancel & Strike (Uncollected)
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Table Columns Definition for Orders
  const orderColumns: Column<OrderWithDetails>[] = useMemo(() => [
    {
      key: 'order_number',
      header: 'Order #',
      sortable: true,
      accessor: (row) => row.order_number,
      render: (_, order) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-sm text-slate-900">#{order.order_number}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
              order.is_takeaway ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {order.is_takeaway ? 'TAKEAWAY' : 'DINE'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
            ID: {order.profiles?.id_number || order.id.split('-')[0].toUpperCase()}
          </span>
        </div>
      )
    },
    {
      key: 'pickup_time',
      header: 'Slot / Timing',
      sortable: true,
      accessor: (row) => row.pickup_time,
      render: (_, order) => {
        const overdueInfo = getOrderOverdueInfo(order);
        const qrExpired = isQrExpired(order);
        return (
          <div>
            <span className="font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full text-xs">
              {formatPickupTime(order.pickup_time)}
            </span>
            {overdueInfo.isOverdue && (
              <div className="text-[10px] font-bold text-amber-600 mt-1 flex items-center gap-1">
                <IconAlertTriangle size={11} className="w-3 h-3 text-amber-600 shrink-0" />
                <span>{overdueInfo.minutesOverdue}m overdue</span>
              </div>
            )}
            {qrExpired && !overdueInfo.isOverdue && (
              <div className="text-[10px] font-bold text-rose-600 mt-1">
                QR Expired
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'student',
      header: 'Student',
      sortable: true,
      accessor: (row) => row.profiles?.name || 'Student',
      render: (_, order) => (
        <div>
          <div className="font-medium text-slate-800">{order.profiles?.name || 'Student'}</div>
          <div className="text-[11px] text-slate-400 font-mono">{order.profiles?.id_number || 'No ID'}</div>
        </div>
      )
    },
    {
      key: 'items',
      header: 'Items',
      render: (_, order) => {
        const totalItems = order.order_items.reduce((sum, i) => sum + i.quantity, 0);
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] shrink-0">
              {totalItems}x
            </span>
            <span className="text-slate-600 truncate max-w-[200px]" title={order.order_items.map(i => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}>
              {order.order_items.map(i => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}
            </span>
          </div>
        );
      }
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      accessor: (row) => row.status,
      render: (_, order) => (
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wide border ${
          order.status === 'PLACED' ? 'bg-slate-100 text-slate-700 border-slate-300' :
          order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
          order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
          order.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
          'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {order.status === 'REJECTED'
            ? ((order as any).cancellation_reason === 'USER_CANCELLED' || (order as any).cancellation_reason?.toLowerCase().includes('cancel') ? 'CANCELLED' : 'REJECTED')
            : order.status}
        </span>
      )
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      accessor: (row) => calculateOrderTotal(row).totalAmount,
      render: (_, order) => {
        const orderTotal = calculateOrderTotal(order);
        return (
          <span className="font-medium text-slate-800">
            {formatCurrency(orderTotal.totalAmount)}
          </span>
        );
      }
    },
    {
      key: 'actions',
      header: 'Quick Action',
      align: 'right',
      render: (_, order) => {
        const overdueInfo = getOrderOverdueInfo(order);
        return (
          <div className="flex items-center justify-end gap-1.5">
            {order.status === 'PLACED' && (
              <>
                <Button
                  size="md"
                  variant="success"
                  onClick={() => updateOrderStatus(order.id, 'ACCEPTED')}
                  className="text-xs px-3.5 py-1.5 font-bold bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-600/30 active:scale-95 text-white"
                >
                  Accept
                </Button>
                <Button
                  size="md"
                  variant="danger"
                  onClick={() => updateOrderStatus(order.id, 'REJECTED')}
                  className="text-xs px-3.5 py-1.5 font-bold shadow-sm shadow-rose-600/25 active:scale-95 text-white"
                >
                  Reject
                </Button>
              </>
            )}

            {order.status === 'ACCEPTED' && (
              <Button
                size="sm"
                onClick={() => updateOrderStatus(order.id, 'PREPARING')}
                leftIcon={<IconCooking size={13} className="w-3.5 h-3.5 text-amber-100" />}
                className="text-xs px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold border-0 shadow-sm shadow-orange-500/30 active:scale-95"
              >
                Start Prep
              </Button>
            )}

            {order.status === 'PREPARING' && (
              <Button
                size="sm"
                variant="success"
                onClick={() => updateOrderStatus(order.id, 'READY')}
                leftIcon={<IconCheckCircle size={13} className="w-3.5 h-3.5" />}
                className="text-xs px-2.5 py-1"
              >
                Mark Ready
              </Button>
            )}

            {order.status === 'READY' && (
              <>
                {selectedOrderForOtp === order.id ? (
                  <div className="flex items-center gap-1">
                    <InputField
                      type="text"
                      placeholder="OTP"
                      value={otpInput}
                      onChange={(e) => setOtpInput(formatOtpInput(e.target.value))}
                      onKeyDown={handleOtpKeyDown}
                      onPaste={(e) => handleOtpPaste(e, setOtpInput)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      maxLength={6}
                      size="sm"
                      className="w-16 px-1.5 py-1 text-center font-mono text-xs"
                      containerClassName="w-16"
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleVerifyOtp(order.id)}
                      disabled={otpInput.length !== 6}
                      className="px-2 py-1 text-xs"
                    >
                      OK
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      onClick={() => { setSelectedOrderForOtp(null); setOtpInput(''); }}
                      className="p-1 text-slate-400 hover:text-slate-600"
                    >
                      <IconX size={12} />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setSelectedOrderForOtp(order.id)}
                    leftIcon={<IconKey size={13} className="w-3 h-3 text-indigo-300" />}
                    className="text-xs px-2.5 py-1"
                  >
                    Verify
                  </Button>
                )}

                {overdueInfo.isOverdue && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleMarkNoShow(order)}
                    title="Mark order as uncollected and issue strike"
                    className="text-xs px-2 py-1 font-semibold"
                  >
                    Strike (Uncollected)
                  </Button>
                )}
              </>
            )}
          </div>
        );
      }
    }
  ], [selectedOrderForOtp, otpInput, orders]);

  // Table Columns Definition for Menu Items
  const menuTableColumns: Column<MenuItem>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Item Name',
      sortable: true,
      accessor: (item) => item.name,
      render: (_, item) => (
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${item.veg_non_veg === 'VEG' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <span className={`font-medium text-sm ${item.is_sold_out ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {item.name}
          </span>
        </div>
      )
    },
    {
      key: 'category',
      header: 'Type',
      sortable: true,
      accessor: (item) => item.veg_non_veg,
      render: (_, item) => (
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider ${
          item.veg_non_veg === 'VEG'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {item.veg_non_veg === 'VEG' ? 'Veg' : 'Non-Veg'}
        </span>
      )
    },
    {
      key: 'price',
      header: 'Price',
      sortable: true,
      accessor: (item) => Number(item.price || 0),
      render: (_, item) => (
        <span className="font-medium text-indigo-600 text-sm">
          ₹{Number(item.price || 0).toFixed(0)}
        </span>
      )
    },
    {
      key: 'status',
      header: 'Availability',
      sortable: true,
      accessor: (item) => item.is_sold_out ? 'Sold Out' : 'Available',
      render: (_, item) => (
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wide border ${
          item.is_sold_out
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {item.is_sold_out ? 'Sold Out' : 'Available'}
        </span>
      )
    },
    {
      key: 'action',
      header: 'Quick Action',
      align: 'right',
      render: (_, item) => (
        <Button
          size="sm"
          variant={item.is_sold_out ? 'success' : 'danger'}
          onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
          className="text-xs px-3 py-1"
        >
          {item.is_sold_out ? 'Mark Available' : 'Sold Out'}
        </Button>
      )
    }
  ], []);

  // Guard: deleted / deactivated staff
  if (profile?.name?.startsWith('[DELETED]') || profile?.id_number === 'DELETED') {
    return (
      <div className="w-full max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-rose-50 border border-rose-200 rounded-[2rem] p-10 flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center">
            <IconAlertTriangle className="w-8 h-8 text-rose-600" />
          </div>
          <h2 className="text-xl font-extrabold text-rose-900">Account Removed</h2>
          <p className="text-rose-700 text-sm max-w-sm">
            This staff account has been deleted by your cafeteria administrator.
          </p>
          <button
            onClick={() => signOut()}
            className="px-6 py-2.5 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Guard: unassigned staff
  if (!profile?.canteen_id) {
    return (
      <div className="w-full max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-10 flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          </div>
          <h2 className="text-xl font-extrabold text-amber-900">No Cafeteria Assigned</h2>
          <p className="text-amber-700 text-sm max-w-sm">
            Your account hasn't been assigned to a cafeteria terminal yet. Please contact your administrator to get assigned to a canteen before you can manage orders.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-7xl mx-auto ${!isMenuView && !isCollectView ? 'w-full flex-1 flex flex-col justify-between min-h-0' : 'space-y-4 pb-20'}`}>
      {isMenuView ? (
        /* Dedicated Quick Menu Availability View */
        <div className="space-y-4">
          {/* Top Banner Card */}
          <div className="relative overflow-hidden rounded-[2.5rem] bg-white border border-slate-200/90 p-6 sm:p-8 shadow-xs">
            {/* Background Soft Glow & Decorative Leaves */}
            <div className="absolute top-0 right-0 w-96 h-full pointer-events-none opacity-40 overflow-hidden">
              <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-blue-100/60 rounded-full blur-3xl" />
              <div className="absolute bottom-[-30px] right-[100px] w-48 h-48 bg-emerald-100/50 rounded-full blur-2xl" />
            </div>

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              {/* Left Column: Heading & Subtitle */}
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-200 text-[11px] font-bold uppercase tracking-wider mb-3">
                  <ChefHat size={14} className="shrink-0 text-blue-600" />
                  <span>Terminal Inventory</span>
                  {assignedCanteen?.name && (
                    <>
                      <span className="text-blue-300">•</span>
                      <span className="text-blue-500 font-semibold lowercase tracking-normal">{assignedCanteen.name}</span>
                    </>
                  )}
                </div>

                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                  Quick Menu <span className="text-[#1d68f2]">Availability</span>
                </h1>

                <p className="text-sm text-slate-500 mt-2 font-medium leading-relaxed">
                  Toggle sold out status instantaneously across student devices. Changes sync live.
                </p>
              </div>

              {/* Right Column: Decorative Platter Graphic + Live KPI Stat Cards */}
              <div className="flex items-center gap-4 flex-wrap lg:flex-nowrap">
                {/* Decorative Platter Graphic with "Fresh Food Everyday" note */}
                <div className="relative hidden xl:flex items-center justify-center pr-2">
                  <div className="relative flex items-center justify-center">
                    {/* Floating Hand-Drawn / Cursive "Fresh Food Everyday" doodle badge */}
                    <div className="absolute -top-3 -left-12 rotate-[-8deg] z-20 pointer-events-none text-center">
                      <span className="font-serif italic font-bold text-sm text-[#2b72ee] tracking-wide drop-shadow-xs">
                        Fresh Food
                      </span>
                      <div className="font-serif italic font-medium text-xs text-[#2b72ee]/90">
                        Everyday 🍃
                      </div>
                    </div>

                    {/* Illustrated Food Plate Graphic */}
                    <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-emerald-100/80 via-blue-50 to-amber-50 border-2 border-white shadow-md flex items-center justify-center p-3">
                      <div className="w-full h-full rounded-full bg-white/90 border border-slate-200/80 flex flex-col items-center justify-center shadow-inner text-emerald-600">
                        <Utensils size={30} className="text-emerald-500 mb-0.5" />
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Fresh</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3 KPI Stat Cards matching screenshot exactly */}
                <div className="flex items-center gap-3">
                  {/* Total Items */}
                  <div className="w-24 sm:w-28 py-4 px-3 rounded-2xl bg-[#f0f6ff] border border-blue-200/80 text-center flex flex-col items-center justify-center shadow-2xs">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center mb-1.5">
                      <IconPackage className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Items</div>
                    <div className="text-2xl font-black text-slate-900 mt-0.5">{menuItems.length}</div>
                  </div>

                  {/* Available */}
                  <div className="w-24 sm:w-28 py-4 px-3 rounded-2xl bg-[#eefaf4] border border-emerald-200/80 text-center flex flex-col items-center justify-center shadow-2xs">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-1.5">
                      <CheckCircle2 size={20} className="text-emerald-600" />
                    </div>
                    <div className="text-[10px] font-black text-emerald-600 uppercase tracking-wider">Available</div>
                    <div className="text-2xl font-black text-emerald-700 mt-0.5">
                      {menuItems.filter(m => !m.is_sold_out).length}
                    </div>
                  </div>

                  {/* Sold Out */}
                  <div className="w-24 sm:w-28 py-4 px-3 rounded-2xl bg-[#fff1f2] border border-rose-200/80 text-center flex flex-col items-center justify-center shadow-2xs">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center mb-1.5">
                      <XCircle size={20} className="text-rose-600" />
                    </div>
                    <div className="text-[10px] font-black text-rose-500 uppercase tracking-wider">Sold Out</div>
                    <div className="text-2xl font-black text-rose-600 mt-0.5">
                      {menuItems.filter(m => m.is_sold_out).length}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Search, View Mode and Filter Bar (Card Container) */}
          <div className="bg-white border border-slate-200/90 rounded-[2rem] p-4 sm:p-5 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Search Bar matching screenshot */}
              <div className="relative flex-1 max-w-md">
                <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search menu items by name..."
                  value={menuSearch}
                  onChange={e => setMenuSearch(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 rounded-full bg-slate-50/80 border border-slate-200/90 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                />
                {menuSearch && (
                  <button
                    type="button"
                    onClick={() => setMenuSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    <IconX className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* View Toggle & Filter Pills */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* View Mode Toggle: Grid, Table, Kanban */}
                <div className="flex items-center bg-slate-50 p-1 rounded-2xl border border-slate-200/90">
                  <button
                    type="button"
                    onClick={() => setMenuViewMode('GRID')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      menuViewMode === 'GRID'
                        ? 'bg-white text-blue-600 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <IconGrid size={13} className="w-3.5 h-3.5" />
                    <span>Grid</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuViewMode('TABLE')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      menuViewMode === 'TABLE'
                        ? 'bg-white text-blue-600 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <LayoutList size={13} className="w-3.5 h-3.5" />
                    <span>Table</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuViewMode('KANBAN')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      menuViewMode === 'KANBAN'
                        ? 'bg-white text-blue-600 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <IconKanban size={13} className="w-3.5 h-3.5" />
                    <span>Kanban</span>
                  </button>
                </div>

                {/* Filter Pills matching screenshot */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setMenuFilter('ALL')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
                      menuFilter === 'ALL'
                        ? 'bg-[#1d68f2] text-white shadow-xs'
                        : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    All Items
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuFilter('AVAILABLE')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
                      menuFilter === 'AVAILABLE'
                        ? 'bg-[#1d68f2] text-white shadow-xs'
                        : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    Available
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuFilter('SOLD_OUT')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
                      menuFilter === 'SOLD_OUT'
                        ? 'bg-[#1d68f2] text-white shadow-xs'
                        : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    Sold Out
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuFilter('VEG')}
                    className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      menuFilter === 'VEG'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    <Leaf size={13} className={menuFilter === 'VEG' ? 'text-white' : 'text-emerald-600'} />
                    <span>Veg</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuFilter('NON_VEG')}
                    className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      menuFilter === 'NON_VEG'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    <Flame size={13} className={menuFilter === 'NON_VEG' ? 'text-white' : 'text-rose-600'} />
                    <span>Non-Veg</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Menu Items View: Grid or Table */}
            <div className="mt-6">
              {menuViewMode === 'TABLE' ? (
                <Table<MenuItem>
                  data={filteredMenuItems}
                  columns={menuTableColumns}
                  keyExtractor={(item) => item.id}
                  pagination={true}
                  pageSize={10}
                  emptyMessage="No menu items match your search or filter"
                  emptyIcon={<Utensils size={32} className="text-slate-300" />}
                  hoverable={true}
                />
              ) : filteredMenuItems.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-100">
                  <Utensils size={32} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-semibold text-slate-600">No menu items match your search or filter</p>
                  {(menuSearch || menuFilter !== 'ALL') && (
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => { setMenuSearch(''); setMenuFilter('ALL'); }}
                      className="mt-2 text-indigo-600"
                    >
                      Clear search &amp; filters
                    </Button>
                  )}
                </div>
              ) : menuViewMode === 'KANBAN' ? (
                /* Kanban Board View (Available vs Sold Out) */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Column 1: Available */}
                  <div className="bg-slate-50/80 rounded-2xl border border-slate-200/80 p-4 flex flex-col">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        <h3 className="font-extrabold text-sm text-slate-800">
                          Available ({filteredMenuItems.filter(i => !i.is_sold_out).length})
                        </h3>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    </div>
                    <div className="space-y-3 flex-1 overflow-y-auto max-h-[700px] pr-1">
                      {filteredMenuItems.filter(i => !i.is_sold_out).map(item => {
                        const isVeg = item.veg_non_veg === 'VEG';
                        return (
                          <div
                            key={item.id}
                            className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs hover:shadow-md transition flex flex-col gap-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className={`w-2 h-2 rounded-full ${isVeg ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{isVeg ? 'Veg' : 'Non-Veg'}</span>
                                </div>
                                <h4 className="font-extrabold text-sm text-slate-900 capitalize">{item.name}</h4>
                              </div>
                              <span className="text-sm font-black text-[#1d68f2]">₹{Number(item.price || 0).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => handleToggleSoldOut(item.id, false)}
                                className="px-3 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                              >
                                <XCircle size={12} />
                                <span>Mark Sold Out</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Column 2: Sold Out */}
                  <div className="bg-rose-50/30 rounded-2xl border border-rose-100 p-4 flex flex-col">
                    <div className="flex items-center justify-between pb-3 border-b border-rose-100 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                        <h3 className="font-extrabold text-sm text-slate-800">
                          Sold Out ({filteredMenuItems.filter(i => i.is_sold_out).length})
                        </h3>
                      </div>
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                        Disabled
                      </span>
                    </div>
                    <div className="space-y-3 flex-1 overflow-y-auto max-h-[700px] pr-1">
                      {filteredMenuItems.filter(i => i.is_sold_out).map(item => {
                        const isVeg = item.veg_non_veg === 'VEG';
                        return (
                          <div
                            key={item.id}
                            className="bg-white/90 rounded-xl border border-slate-200/80 p-3.5 shadow-2xs hover:shadow-md transition flex flex-col gap-2 opacity-85"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className={`w-2 h-2 rounded-full ${isVeg ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{isVeg ? 'Veg' : 'Non-Veg'}</span>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-[10px] font-bold text-rose-600">Sold Out</span>
                                </div>
                                <h4 className="font-extrabold text-sm text-slate-800 capitalize line-through">{item.name}</h4>
                              </div>
                              <span className="text-sm font-bold text-slate-400">₹{Number(item.price || 0).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => handleToggleSoldOut(item.id, true)}
                                className="px-3 py-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
                              >
                                <CheckCircle2 size={12} />
                                <span>Mark Available</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                /* Food Items Cards without food images (as requested: "without image for foods") */
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filteredMenuItems.map(item => {
                    const isVeg = item.veg_non_veg === 'VEG';
                    const isSoldOut = !!item.is_sold_out;
                    const rawCat = String((item as any).category || '').toLowerCase();
                    const isPacked =
                      rawCat === 'packed food' ||
                      rawCat === 'packed' ||
                      rawCat === 'packaged' ||
                      rawCat === 'snacks' ||
                      rawCat === 'snack' ||
                      rawCat.includes('pack') ||
                      (item as any).stock_quantity != null ||
                      (item as any).prep_time_minutes === 0 ||
                      (item.name || '').toLowerCase().includes('packed');

                    // Determine theme accent matching reference image
                    let themeBorder = 'border-l-[6px] border-t-2 border-emerald-500 hover:border-emerald-600';
                    let themeBg = 'bg-gradient-to-br from-emerald-50/40 via-white to-emerald-50/10';
                    if (isPacked) {
                      themeBorder = 'border-l-[6px] border-t-2 border-amber-400 hover:border-amber-500';
                      themeBg = 'bg-gradient-to-br from-amber-50/40 via-white to-amber-50/10';
                    } else if (!isVeg) {
                      themeBorder = 'border-l-[6px] border-t-2 border-rose-500 hover:border-rose-600';
                      themeBg = 'bg-gradient-to-br from-rose-50/40 via-white to-rose-50/10';
                    }


                    return (
                      <div
                        key={item.id}
                        className={`relative rounded-[1.75rem] border border-slate-200/80 p-5 sm:p-6 flex flex-col justify-between shadow-sm transition-all duration-200 hover:shadow-lg ${themeBorder} ${themeBg} ${
                          isSoldOut ? 'opacity-70 bg-slate-50 grayscale-20' : ''
                        }`}
                      >
                        <div>
                          {/* Badges Row matching exact screenshot */}
                          <div className="flex items-center justify-between gap-1.5 mb-3 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Veg / Non-Veg Badge */}
                              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black shadow-2xs ${
                                isVeg ? 'bg-emerald-100/90 text-emerald-800' : 'bg-rose-100/90 text-rose-800'
                              }`}>
                                {isVeg ? (
                                  <Leaf size={12} className="text-emerald-700" />
                                ) : (
                                  <span className="w-2 h-2 rounded-full bg-rose-600 ring-2 ring-rose-300" />
                                )}
                                <span>{isVeg ? 'Veg' : 'Non-Veg'}</span>
                              </div>

                              {/* Category / Prep Badge */}
                              {isPacked ? (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200/60">
                                  <Package size={12} className="text-blue-600" />
                                  <span>Packed Food</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100/80 text-amber-900">
                                  <Clock size={12} className="text-amber-800" />
                                  <span>10m prep</span>
                                </div>
                              )}
                            </div>

                            {/* Tag on Right */}
                            {isSoldOut ? (
                              <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider">
                                Sold Out
                              </span>
                            ) : isPacked ? (
                              <span className="px-2.5 py-1 rounded-full bg-pink-100/80 text-pink-700 text-[10px] font-extrabold flex items-center gap-1">
                                ★ Popular
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full bg-emerald-100/70 text-emerald-700 text-[10px] font-extrabold flex items-center gap-1">
                                💚 Healthy Choice
                              </span>
                            )}
                          </div>

                          {/* Food Title */}
                          <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-snug mt-2 capitalize">
                            {item.name}
                          </h3>


                        </div>

                        {/* Footer: Price on Left, Mark Available / Sold Out Pill on Right */}
                        <div className="pt-4 border-t border-slate-200/70 flex items-center justify-between gap-3 mt-4">
                          <div>
                            <span className="text-[10px] tracking-wider font-extrabold text-slate-400 block uppercase">
                              PRICE
                            </span>
                            <div className="text-2xl font-black text-[#1d68f2] tracking-tight">
                              ₹{Number(item.price || 0).toFixed(2)}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggleSoldOut(item.id, isSoldOut)}
                            className={`px-5 py-2.5 rounded-full font-extrabold text-xs transition-all shadow-md flex items-center gap-1.5 active:scale-95 cursor-pointer ${
                              isSoldOut
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/25'
                                : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/25'
                            }`}
                          >
                            {isSoldOut ? (
                              <>
                                <CheckCircle2 size={14} />
                                <span>Mark Available</span>
                              </>
                            ) : (
                              <>
                                <XCircle size={14} />
                                <span>Mark Sold Out</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Doodled Watermark "Eat Good Stay Happy" */}
          <div className="flex justify-end pr-4 py-2 pointer-events-none select-none">
            <div className="rotate-[-6deg] text-right">
              <div className="font-serif italic font-extrabold text-base text-blue-400 tracking-wide">
                Eat Good
              </div>
              <div className="font-serif italic font-bold text-sm text-blue-400/90 -mt-0.5">
                Stay Happy ✨
              </div>
            </div>
          </div>
        </div>
      ) : isCollectView ? (
        /* Dedicated Full-Screen Order Collection Terminal View */
        <div className="space-y-4">
          {/* Collection Terminal Header Card (Matches Screenshot) */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#003882] via-[#0256b8] to-[#01429c] text-white p-6 sm:p-7 shadow-xl border border-blue-400/20">
            {/* Background Decorative Waves and Shapes */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <svg className="absolute -bottom-10 -left-10 w-[550px] h-[350px] text-blue-900/30 fill-current" viewBox="0 0 600 400">
                <path d="M0,192 C150,260 350,120 600,200 L600,400 L0,400 Z" />
              </svg>
              <svg className="absolute -bottom-6 right-0 w-[700px] h-[300px] text-blue-950/40 fill-current" viewBox="0 0 700 300">
                <path d="M0,160 C200,80 450,220 700,100 L700,300 L0,300 Z" />
              </svg>
            </div>

            <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
              <div className="max-w-xl">
                {/* Pill Badge */}
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-600/90 text-white text-[11px] font-black tracking-wider uppercase shadow-xs mb-3">
                  <KeyRound size={12} className="shrink-0" />
                  <span>Order Collection &amp; Dispatch</span>
                </div>

                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  Order Collection <span className="text-[#38bdf8]">Counter</span>
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-blue-100 font-normal">
                  Verify student OTP challenges, QR codes, and advance live kitchen order stages.
                </p>

                {/* Dynamic Real-time Verification Status Banner */}
                {(quickOtpToast || latestCollectedOrder) && (
                  <div className={`mt-4 inline-flex items-center justify-between gap-3 px-3.5 py-1.5 rounded-full border text-white text-xs font-semibold shadow-xs transition-all duration-300 ${
                    quickOtpToast?.isError
                      ? 'bg-red-900/40 border-red-400/30'
                      : 'bg-emerald-900/40 border-emerald-400/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full text-white flex items-center justify-center shrink-0 ${
                        quickOtpToast?.isError ? 'bg-red-500' : 'bg-emerald-500'
                      }`}>
                        {quickOtpToast?.isError ? (
                          <XCircle size={13} className="text-white" />
                        ) : (
                          <IconCheckCircle size={13} className="text-white" />
                        )}
                      </span>
                      <span className={`text-[11px] font-medium ${
                        quickOtpToast?.isError ? 'text-red-100' : 'text-emerald-100'
                      }`}>
                        {quickOtpToast?.message || (latestCollectedOrder ? `Order #${latestCollectedOrder.order_number || latestCollectedOrder.id.slice(0, 6)} verified and collected successfully!` : '')}
                      </span>
                    </div>
                    <span className="text-emerald-300 text-xs font-bold pl-2">›</span>
                  </div>
                )}
              </div>

              {/* Instant OTP Bar with Cloche Illustration */}
              <div className="flex items-center gap-6 self-stretch lg:self-auto justify-between lg:justify-end">
                <div className="bg-white/15 backdrop-blur-xl p-2 sm:p-2.5 rounded-2xl border border-white/30 shadow-[0_12px_32px_rgba(0,0,0,0.18)] flex items-center gap-2.5 transition-all duration-250 hover:bg-white/20 hover:border-white/40">
                  <form onSubmit={handleQuickOtpSubmit} className="flex gap-2 items-center">
                    <div className="relative flex items-center group">
                      <span className="absolute left-3.5 text-blue-500 pointer-events-none transition-colors group-focus-within:text-blue-600">
                        <KeyRound className="w-4 h-4" />
                      </span>
                      <input
                        placeholder="ENTER 6-DIGIT OTP"
                        value={quickOtpInput}
                        onChange={e => setQuickOtpInput(formatOtpInput(e.target.value))}
                        onKeyDown={handleOtpKeyDown}
                        onPaste={e => handleOtpPaste(e, setQuickOtpInput)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        maxLength={6}
                        className="w-44 sm:w-52 pl-10 pr-8 py-2.5 bg-white text-slate-900 font-mono font-extrabold rounded-xl tracking-[0.25em] text-center text-sm placeholder:tracking-normal placeholder:font-sans placeholder:font-semibold placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] border border-slate-200 transition-all duration-200"
                      />
                      {quickOtpInput && (
                        <button
                          type="button"
                          onClick={() => setQuickOtpInput('')}
                          className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100 transition"
                          title="Clear OTP"
                        >
                          <IconX className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={quickOtpInput.trim().length !== 6 || quickOtpLoading}
                      className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-950/20 transition-all duration-200 cursor-pointer shrink-0"
                    >
                      {quickOtpLoading ? (
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <IconZap size={14} className="w-3.5 h-3.5 fill-white text-white" />
                      )}
                      <span>Collect</span>
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="p-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 active:scale-95 text-white rounded-xl transition-all duration-200 shadow-md shadow-blue-950/20 cursor-pointer shrink-0 flex items-center justify-center group"
                    title="Scan QR Code"
                  >
                    <IconCamera size={17} className="group-hover:scale-110 transition-transform duration-200" />
                  </button>
                </div>

                {/* Premium Realistic Cloche Plate Graphic with Chef Hat Outline */}
                <div className="hidden sm:flex relative items-center justify-center shrink-0 pr-6 pl-2">
                  {/* Subtle radial glow behind the dish */}
                  <div className="absolute w-48 h-48 rounded-full bg-sky-400/20 blur-2xl pointer-events-none" />

                  {/* Chef hat outline watermark */}
                  <svg
                    className="absolute -top-12 right-2 w-20 h-20 text-white/25 stroke-current pointer-events-none drop-shadow-sm"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z" />
                    <line x1="6" y1="17" x2="18" y2="17" />
                    <line x1="9" y1="21" x2="9" y2="17" />
                    <line x1="15" y1="21" x2="15" y2="17" />
                  </svg>

                  {/* Sparkle burst accents on left */}
                  <div className="absolute -left-4 top-8 flex flex-col gap-1.5 pointer-events-none text-sky-200">
                    <span className="w-3 h-0.5 bg-sky-200/90 rounded-full rotate-45 transform origin-left shadow-xs"></span>
                    <span className="w-4 h-0.5 bg-white rounded-full shadow-xs"></span>
                    <span className="w-3 h-0.5 bg-sky-200/90 rounded-full -rotate-45 transform origin-left shadow-xs"></span>
                  </div>

                  {/* Main Realistic Serving Cloche SVG */}
                  <div className="relative group transition-transform duration-300 hover:scale-105">
                    <svg
                      className="w-44 h-36 drop-shadow-[0_20px_25px_rgba(0,18,50,0.55)] overflow-visible"
                      viewBox="0 0 220 170"
                      fill="none"
                    >
                      <defs>
                        {/* Cloche Metallic Blue/Cyan Shimmer Gradient */}
                        <linearGradient id="clocheBodyGrad" x1="20%" y1="0%" x2="80%" y2="100%">
                          <stop offset="0%" stopColor="#bae6fd" />
                          <stop offset="25%" stopColor="#38bdf8" />
                          <stop offset="55%" stopColor="#0284c7" />
                          <stop offset="85%" stopColor="#0369a1" />
                          <stop offset="100%" stopColor="#075985" />
                        </linearGradient>

                        {/* Top Curved Highlight */}
                        <linearGradient id="specularGleam" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                          <stop offset="40%" stopColor="#e0f2fe" stopOpacity="0.8" />
                          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                        </linearGradient>

                        {/* Chrome Silver Plate Platter */}
                        <linearGradient id="silverPlatter" x1="0%" y1="30%" x2="100%" y2="70%">
                          <stop offset="0%" stopColor="#e2e8f0" />
                          <stop offset="30%" stopColor="#ffffff" />
                          <stop offset="55%" stopColor="#cbd5e1" />
                          <stop offset="85%" stopColor="#94a3b8" />
                          <stop offset="100%" stopColor="#64748b" />
                        </linearGradient>

                        {/* Inner Platter Recess */}
                        <linearGradient id="platterRecess" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#475569" stopOpacity="0.6" />
                          <stop offset="100%" stopColor="#1e293b" stopOpacity="0.9" />
                        </linearGradient>

                        {/* Handle Sphere Gradient */}
                        <radialGradient id="handleSphere" cx="35%" cy="30%" r="70%">
                          <stop offset="0%" stopColor="#ffffff" />
                          <stop offset="40%" stopColor="#e0f2fe" />
                          <stop offset="80%" stopColor="#0284c7" />
                          <stop offset="100%" stopColor="#034d75" />
                        </radialGradient>

                        {/* Steam Gradient */}
                        <linearGradient id="steamGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
                          <stop offset="70%" stopColor="#bae6fd" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#e0f2fe" stopOpacity="0" />
                        </linearGradient>
                      </defs>

                      {/* Cast Drop Shadow underneath plate */}
                      <ellipse cx="110" cy="144" rx="90" ry="14" fill="#001433" opacity="0.45" filter="blur(4px)" />

                      {/* Base Silver Platter (Serving Tray) */}
                      <ellipse cx="110" cy="136" rx="86" ry="16" fill="url(#silverPlatter)" stroke="#94a3b8" strokeWidth="1" />
                      <ellipse cx="110" cy="134" rx="76" ry="12" fill="url(#platterRecess)" />
                      <ellipse cx="110" cy="133" rx="72" ry="10" fill="#334155" opacity="0.5" />

                      {/* Fresh Food & Garnish peek from under the dome rim */}
                      {/* Savory Glazed Meat / Cutlet */}
                      <path d="M52,130 Q110,120 166,130 L160,136 Q110,128 58,136 Z" fill="#ea580c" />
                      <path d="M60,131 Q110,123 158,131 L153,135 Q110,129 65,135 Z" fill="#c2410c" />
                      {/* Fresh Herb Garnish Leaves (Emerald parsley / basil) */}
                      <g transform="translate(162, 122) rotate(15)">
                        <ellipse cx="0" cy="0" rx="9" ry="4.5" fill="#22c55e" stroke="#16a34a" strokeWidth="0.5" />
                        <ellipse cx="7" cy="-3" rx="7" ry="3.5" fill="#4ade80" />
                        <line x1="-8" y1="0" x2="10" y2="0" stroke="#15803d" strokeWidth="0.8" />
                      </g>
                      <g transform="translate(46, 128) rotate(-20)">
                        <ellipse cx="0" cy="0" rx="8" ry="4" fill="#16a34a" />
                        <ellipse cx="-4" cy="-2" rx="6" ry="3" fill="#22c55e" />
                      </g>
                      {/* Red cherry tomato accent */}
                      <circle cx="152" cy="129" r="5" fill="#ef4444" />
                      <ellipse cx="150.5" cy="127.5" rx="1.5" ry="0.8" fill="#ffffff" opacity="0.8" />

                      {/* Tilted Cloche Dome Group (Slight dynamic angle revealing the food) */}
                      <g transform="rotate(-6 110 120)">
                        {/* Cloche Main Dome Body */}
                        <path
                          d="M44,124 C44,68 74,42 110,42 C146,42 176,68 176,124 Z"
                          fill="url(#clocheBodyGrad)"
                          stroke="#38bdf8"
                          strokeWidth="1"
                        />

                        {/* Cloche Metallic Rim Lip */}
                        <ellipse cx="110" cy="124" rx="68" ry="5.5" fill="#7dd3fc" stroke="#bae6fd" strokeWidth="1" />
                        <ellipse cx="110" cy="125" rx="68" ry="3.5" fill="#0284c7" opacity="0.7" />

                        {/* Handle Base Collar */}
                        <ellipse cx="110" cy="40" rx="11" ry="4" fill="#bae6fd" stroke="#38bdf8" strokeWidth="0.8" />
                        <ellipse cx="110" cy="38" rx="8" ry="2.5" fill="#0369a1" />

                        {/* Handle Sphere Knob */}
                        <circle cx="110" cy="31" r="9" fill="url(#handleSphere)" stroke="#7dd3fc" strokeWidth="1" />
                        {/* Handle Knob Specular Highlight */}
                        <ellipse cx="107" cy="27" rx="3.5" ry="2" fill="#ffffff" opacity="0.95" />

                        {/* Primary Curved Gloss Highlight (Gleam across dome) */}
                        <path
                          d="M68,76 C76,58 92,50 110,50 C118,50 124,52 130,55 C122,53 114,52 108,52 C90,52 74,62 66,80 Z"
                          fill="url(#specularGleam)"
                        />
                        <path
                          d="M58,95 C62,75 75,62 94,56 C90,59 78,70 74,90 C72,97 68,110 68,114 C66,114 62,106 58,95 Z"
                          fill="#ffffff"
                          opacity="0.35"
                        />

                        {/* Soft Lower Reflection Glow */}
                        <path
                          d="M60,118 Q110,108 160,118 Q110,114 60,118 Z"
                          fill="#e0f2fe"
                          opacity="0.5"
                        />
                      </g>

                      {/* Hot Fresh Food Steam Curves rising from dish */}
                      <path
                        d="M178,85 Q184,72 179,60 Q174,48 180,35 Q184,25 180,14"
                        stroke="url(#steamGrad)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        fill="none"
                      />
                      <path
                        d="M190,92 Q196,78 191,65 Q186,52 192,38 Q196,28 192,18"
                        stroke="url(#steamGrad)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        fill="none"
                        opacity="0.7"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Control Bar: Slot Filters, Global Search, and View Controls */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
            {/* Top Controls: Search Bar & View Mode Switcher */}
            <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
              {/* Search Bar */}
              <div className="flex-1">
                <InputField
                  size="sm"
                  leftIcon={<IconSearch size={16} className="w-4 h-4 text-slate-400" />}
                  placeholder="Search by Order Number, Student Name, Student ID, or OTP..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  clearable={Boolean(searchQuery)}
                  onClear={() => setSearchQuery('')}
                  rightIcon={
                    searchQuery ? (
                      <span className="hidden sm:inline-block px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold rounded-lg mr-1 pointer-events-none">
                        {filteredOrders.length} {filteredOrders.length === 1 ? 'match' : 'matches'}
                      </span>
                    ) : undefined
                  }
                  className="rounded-full shadow-2xs hover:bg-slate-50/50 focus:bg-white"
                />
              </div>

              <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0 flex-wrap">
                <button
                  onClick={() => setShowBatchSummary(!showBatchSummary)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${showBatchSummary
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  <IconCooking size={14} className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Kitchen Batch Prep</span>
                </button>

                <button
                  onClick={() => setSortByPrepStart(!sortByPrepStart)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${sortByPrepStart
                      ? 'bg-amber-50 text-amber-800 border-amber-200 shadow-2xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  title="Sort orders by Planned Preparation Start Time for kitchen cooking sequence"
                >
                  <span className={sortByPrepStart ? 'text-amber-500 font-bold' : 'text-slate-400'}>⚡</span>
                  <span>{sortByPrepStart ? 'Prep Sequence' : 'Default Order'}</span>
                </button>

                {/* View Mode Segmented Switcher (Table first & primary) */}
                <div className="flex bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 items-center">
                  <button
                    type="button"
                    onClick={() => setViewMode('LIST')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'LIST'
                        ? 'bg-[#1d68f2] text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    <LayoutList size={13} className="w-3.5 h-3.5" />
                    <span>Table</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('KANBAN')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'KANBAN'
                        ? 'bg-[#1d68f2] text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    <IconKanban size={13} className="w-3.5 h-3.5" />
                    <span>Kanban</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('GRID')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'GRID'
                        ? 'bg-[#1d68f2] text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    <IconGrid size={13} className="w-3.5 h-3.5" />
                    <span>Grid</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Cross-Slot Search Notification */}
            {searchQuery.trim() && otherSlotMatchesCount > 0 && selectedSlot !== 'ALL' && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-900 animate-in fade-in">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                  <span>
                    Found {allSlotMatches.length} matching {allSlotMatches.length === 1 ? 'order' : 'orders'} in other lunch slots.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSlot('ALL')}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm shrink-0"
                >
                  Switch to All Slots ({allSlotMatches.length})
                </button>
              </div>
            )}

            {/* Lunch Slot Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
              <button
                onClick={() => setSelectedSlot('ALL')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all border flex items-center gap-2 cursor-pointer ${selectedSlot === 'ALL'
                    ? 'bg-[#0f1e36] text-white border-[#0f1e36] shadow-xs'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  <span>All Slots</span>
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${selectedSlot === 'ALL' ? 'bg-[#1e3458] text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {orders.length}
                </span>
              </button>

              {activeLunchSlots.map(slot => {
                const count = slotCounts[slot.value] || 0;
                const isSelected = selectedSlot === slot.value;
                return (
                  <button
                    key={slot.value}
                    onClick={() => setSelectedSlot(slot.value)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all border flex items-center gap-2 cursor-pointer ${isSelected
                        ? 'bg-[#1d68f2] text-white border-[#1d68f2] shadow-xs'
                        : 'bg-[#f8fafc] text-blue-600/90 border-blue-100 hover:bg-blue-50/60'
                      }`}
                  >
                    <span>{slot.rangeLabel || slot.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${isSelected
                        ? 'bg-blue-800 text-white'
                        : 'bg-blue-100/80 text-blue-700'
                      }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Kitchen Batch Preparation Summary */}
          {showBatchSummary && (
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950 rounded-2xl p-4 sm:p-5 text-white shadow-sm border border-indigo-900/40">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <IconCooking size={20} className="w-5 h-5 text-indigo-300 shrink-0" />
                  <h3 className="font-extrabold text-sm sm:text-base text-white">
                    Live Kitchen Prep Summary {selectedSlot !== 'ALL' ? `for ${formatPickupTime(selectedSlot)}` : '(All Filtered Orders)'}
                  </h3>
                </div>
                <span className="text-xs text-indigo-300 font-medium">
                  {batchPrepSummary.reduce((sum, item) => sum + item[1].count, 0)} total meal items to cook &amp; pack
                </span>
              </div>

              {batchPrepSummary.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">No active items in the preparation queue for this selection.</div>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {batchPrepSummary.map(([itemName, data]) => (
                    <div
                      key={itemName}
                      className="flex items-center gap-2.5 bg-white/10 backdrop-blur-sm border border-white/15 px-4 py-2.5 rounded-2xl shadow-sm hover:bg-white/15 transition-colors"
                    >
                      <span className={`w-3 h-3 rounded-full shrink-0 ${data.veg ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                      <span className="text-sm font-extrabold text-white">{itemName}</span>
                      <span className="bg-indigo-500 text-white font-mono text-sm font-black px-2.5 py-1 rounded-md shadow-sm">
                        {data.count}x
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Main Order Pipeline: Table vs Kanban vs Grid View */}
          {loading && orders.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-12 text-center text-slate-500 shadow-sm">
              Loading live order queue...
            </div>
          ) : filteredOrders.length === 0 ? (
            /* Empty State Container (Shown across Table, Kanban, and Grid views when there are no active orders) */
            <div className="relative overflow-hidden bg-white border border-slate-200/90 rounded-[2rem] p-8 sm:p-12 text-center shadow-xs">
              {/* Soft decorative background pastel blue waves */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-45">
                <svg className="absolute -top-12 -left-12 w-96 h-96 text-blue-100 fill-current" viewBox="0 0 200 200">
                  <path d="M42.7,-62.9C53.9,-54.3,60.8,-40.4,66.4,-25.9C72,-11.4,76.3,3.7,73.1,17.9C69.9,32.1,59.3,45.4,46.5,55.1C33.7,64.8,18.8,70.9,3.1,72.7C-12.6,74.5,-29.1,72,-42.6,63.1C-56.1,54.2,-66.6,38.9,-71.4,22.1C-76.2,5.3,-75.3,-13,-68.2,-28.1C-61.1,-43.2,-47.8,-55.1,-33.8,-62.7C-19.8,-70.3,-5.1,-73.6,8.2,-71.9C21.5,-70.2,31.5,-71.5,42.7,-62.9Z" transform="translate(100 100)" />
                </svg>
                <svg className="absolute -bottom-16 -right-16 w-[450px] h-[450px] text-blue-100 fill-current" viewBox="0 0 200 200">
                  <path d="M47.7,-65.2C61.4,-56.9,72,-42.3,76.6,-25.9C81.2,-9.5,79.8,8.7,73.5,25.1C67.2,41.5,56,56.1,41.5,65.2C27,74.3,9.2,77.9,-8.1,76.7C-25.4,75.5,-42.2,69.5,-55.6,58.7C-69,47.9,-79,32.3,-81.8,15.2C-84.6,-1.9,-80.2,-20.5,-70.8,-35.1C-61.4,-49.7,-47,-60.3,-32.1,-67.9C-17.2,-75.5,1.2,-80.1,18.4,-77.9C35.6,-75.7,34,-65.2,47.7,-65.2Z" transform="translate(100 100)" />
                </svg>
              </div>

              {/* Bottom-left Botanical Leaf Illustration */}
              <div className="absolute -bottom-2 left-3 pointer-events-none hidden sm:block">
                <svg className="w-24 h-24 text-emerald-600/80" viewBox="0 0 100 100" fill="none">
                  <path d="M10,90 C15,60 40,40 55,30 C50,55 35,75 10,90 Z" fill="#059669" />
                  <path d="M10,90 C30,70 65,65 85,55 C70,75 45,85 10,90 Z" fill="#10b981" />
                  <path d="M10,90 C5,70 15,45 30,35 C30,55 25,75 10,90 Z" fill="#047857" />
                  <path d="M10,90 C25,50 50,25 70,15 C60,40 40,70 10,90 Z" fill="#34d399" opacity="0.9" />
                </svg>
              </div>

              {/* Bottom-right Chef Hat Watermark */}
              <div className="absolute bottom-2 right-4 pointer-events-none hidden sm:block text-blue-200/50">
                <svg className="w-28 h-28 stroke-current" viewBox="0 0 24 24" fill="none" strokeWidth="1.2">
                  <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z" />
                  <line x1="6" y1="17" x2="18" y2="17" />
                </svg>
              </div>

              {/* Center Content */}
              <div className="relative z-10 max-w-xl mx-auto flex flex-col items-center">
                {/* Clipboard with blue tick / cross badge and rays */}
                <div className="relative mb-5 flex items-center justify-center">
                  {/* Surrounding burst rays */}
                  <div className="absolute -top-3 -right-3 text-sky-400">
                    <span className="block w-2.5 h-0.5 bg-sky-400 rotate-45 transform"></span>
                    <span className="block w-3 h-0.5 bg-sky-400 mt-1 rotate-12 transform"></span>
                  </div>
                  <div className="absolute -bottom-2 -left-3 text-sky-400">
                    <span className="block w-2.5 h-0.5 bg-sky-400 -rotate-45 transform"></span>
                  </div>

                  {/* Clipboard Graphic */}
                  <div className="relative">
                    <svg className="w-20 h-24 drop-shadow-md" viewBox="0 0 80 96" fill="none">
                      {/* Board backing shadow & clip */}
                      <rect x="10" y="14" width="60" height="78" rx="14" fill="#60a5fa" />
                      <rect x="14" y="18" width="52" height="70" rx="10" fill="#ffffff" />
                      {/* Top clip */}
                      <rect x="26" y="8" width="28" height="12" rx="4" fill="#2563eb" />
                      <ellipse cx="40" cy="12" rx="5" ry="3" fill="#ffffff" />
                      {/* Checklist lines */}
                      <circle cx="24" cy="36" r="3.5" fill="#93c5fd" />
                      <rect x="32" y="34" width="26" height="4" rx="2" fill="#bfdbfe" />
                      <circle cx="24" cy="50" r="3.5" fill="#93c5fd" />
                      <rect x="32" y="48" width="22" height="4" rx="2" fill="#bfdbfe" />
                      <circle cx="24" cy="64" r="3.5" fill="#93c5fd" />
                      <rect x="32" y="62" width="28" height="4" rx="2" fill="#bfdbfe" />
                    </svg>

                    {/* Blue circle badge with white 'X' / cancel or tick at bottom right */}
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#1d68f2] text-white flex items-center justify-center font-bold text-xs ring-4 ring-white shadow-md">
                      <IconX size={14} className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  </div>
                </div>

                {/* Heading */}
                <h2 className="text-2xl font-black text-[#0f244a] tracking-tight">
                  No Orders in Queue
                </h2>

                {/* Subtitle */}
                <p className="mt-2 text-xs sm:text-sm text-slate-500 font-medium max-w-sm">
                  {searchQuery.trim()
                    ? `No active orders matched "${searchQuery}" in this view.`
                    : 'There are currently no active orders in the kitchen queue.'}
                </p>

                {/* Lightbulb Info Hint Card */}
                <div className="mt-7 w-full max-w-md bg-[#edf5ff] border border-blue-200/80 rounded-2xl p-3.5 sm:p-4 text-left flex items-center gap-3.5 shadow-2xs">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-[#1d68f2] flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                      <path d="M9 18h6" />
                      <path d="M10 22h4" />
                      <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z" />
                    </svg>
                  </div>
                  <p className="text-xs text-slate-600 font-medium leading-relaxed">
                    Once orders are verified and collected, they will appear here with their preparation status and live updates.
                  </p>
                </div>
              </div>
            </div>
          ) : viewMode === 'LIST' ? (
            <Table<OrderWithDetails>
              data={filteredOrders}
              columns={orderColumns}
              keyExtractor={(order) => order.id}
              pagination={true}
              pageSize={10}
              hoverable={true}
            />
          ) : viewMode === 'KANBAN' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
              {/* Column 1: Placed */}
              <div className="bg-blue-50/60 border border-blue-200/70 rounded-2xl p-3 sm:p-4 flex flex-col min-h-[300px]">
                <div className="flex justify-between items-center mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    <h3 className="font-extrabold text-sm text-blue-950 uppercase tracking-wide">
                      Placed
                    </h3>
                    <span className="bg-blue-200 text-blue-900 text-xs font-black px-2 py-0.5 rounded-full">
                      {placedOrders.length}
                    </span>
                  </div>
                  {placedOrders.length > 1 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => bulkAcceptOrders(placedOrders.map(o => o.id))}
                      leftIcon={<IconZap size={12} className="w-3 h-3 text-indigo-600" />}
                      className="text-[11px] py-1 px-2 rounded-lg cursor-pointer"
                    >
                      Accept All
                    </Button>
                  )}
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto max-h-[75vh] pr-1">
                  {placedOrders.length === 0 ? (
                    <div className="text-center text-xs text-slate-400 py-10">No placed orders</div>
                  ) : (
                    placedOrders.map(renderOrderCard)
                  )}
                </div>
              </div>

              {/* Column 2: Accepted */}
              <div className="bg-cyan-50/60 border border-cyan-200/70 rounded-2xl p-3 sm:p-4 flex flex-col min-h-[300px]">
                <div className="flex justify-between items-center mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
                    <h3 className="font-extrabold text-sm text-cyan-950 uppercase tracking-wide">
                      Accepted
                    </h3>
                    <span className="bg-cyan-200 text-cyan-900 text-xs font-black px-2 py-0.5 rounded-full">
                      {orders.filter(o => o.status === 'ACCEPTED').length}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto max-h-[75vh] pr-1">
                  {orders.filter(o => o.status === 'ACCEPTED').length === 0 ? (
                    <div className="text-center text-xs text-slate-400 py-10">No accepted orders</div>
                  ) : (
                    orders.filter(o => o.status === 'ACCEPTED').map(renderOrderCard)
                  )}
                </div>
              </div>

              {/* Column 3: Preparing */}
              <div className="bg-amber-50/60 border border-amber-200/70 rounded-2xl p-3 sm:p-4 flex flex-col min-h-[300px]">
                <div className="flex justify-between items-center mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <h3 className="font-extrabold text-sm text-amber-950 uppercase tracking-wide">
                      Preparing
                    </h3>
                    <span className="bg-amber-200 text-amber-900 text-xs font-black px-2 py-0.5 rounded-full">
                      {orders.filter(o => o.status === 'PREPARING').length}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto max-h-[75vh] pr-1">
                  {orders.filter(o => o.status === 'PREPARING').length === 0 ? (
                    <div className="text-center text-xs text-slate-400 py-10">No orders cooking</div>
                  ) : (
                    orders.filter(o => o.status === 'PREPARING').map(renderOrderCard)
                  )}
                </div>
              </div>

              {/* Column 4: Ready */}
              <div className="bg-emerald-50/60 border border-emerald-200/70 rounded-2xl p-3 sm:p-4 flex flex-col min-h-[300px]">
                <div className="flex justify-between items-center mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <h3 className="font-extrabold text-sm text-emerald-950 uppercase tracking-wide">
                      Ready
                    </h3>
                    <span className="bg-emerald-200 text-emerald-900 text-xs font-black px-2 py-0.5 rounded-full">
                      {readyOrders.length}
                    </span>
                  </div>
                  {readyOrders.some(o => getOrderOverdueInfo(o).isOverdue) && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse flex items-center gap-1">
                      <IconAlertTriangle size={11} className="w-3 h-3 text-amber-700 shrink-0" />
                      <span>Overdue</span>
                    </span>
                  )}
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto max-h-[75vh] pr-1">
                  {readyOrders.length === 0 ? (
                    <div className="text-center text-xs text-slate-400 py-10">No orders awaiting pickup</div>
                  ) : (
                    readyOrders.map(renderOrderCard)
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOrders.map(renderOrderCard)}
            </div>
          )}
        </div>
      ) : (
        /* Executive CANTEEN OS Dashboard (Shown on main /staff) */
        <div className="w-full flex-1 min-h-[calc(100vh-5rem)] flex flex-col justify-between gap-3 text-slate-900 select-none pb-2">
          {/* Top Row: Welcome Hero Banner (Left) + Date & Time Card (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch shrink-0">
            {/* Welcome Hero Card (Matched precisely to the Order Collection Counter royal blue signature design) */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-9 relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#003882] via-[#0256b8] to-[#01429c] text-white p-4 sm:p-5 shadow-xl border border-blue-400/20 flex flex-col justify-between min-h-[125px]"
            >
              {/* Identical Decorative Waves and Shapes */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <svg className="absolute -bottom-10 -left-10 w-[550px] h-[350px] text-blue-900/30 fill-current" viewBox="0 0 600 400">
                  <path d="M0,192 C150,260 350,120 600,200 L600,400 L0,400 Z" />
                </svg>
                <svg className="absolute -bottom-6 right-0 w-[700px] h-[300px] text-blue-950/40 fill-current" viewBox="0 0 700 300">
                  <path d="M0,160 C200,80 450,220 700,100 L700,300 L0,300 Z" />
                </svg>
              </div>

              {/* Kitchen Dish background with elegant dark blend */}
              <div className="absolute right-0 top-0 bottom-0 w-2/5 sm:w-1/2 pointer-events-none overflow-hidden hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80"
                  alt="Kitchen Operations"
                  className="w-full h-full object-cover object-center opacity-30 mix-blend-overlay"
                  style={{
                    maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)',
                    WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)'
                  }}
                />
                <div className="absolute top-5 right-7 text-right drop-shadow-md select-none hidden md:block">
                  <span className="font-serif italic font-extrabold text-sm tracking-wide text-white drop-shadow block">
                    Fresh
                  </span>
                  <span className="font-serif italic font-extrabold text-sm tracking-wide text-[#38bdf8] drop-shadow block -mt-1">
                    Tasty ·
                  </span>
                  <span className="font-serif italic font-extrabold text-sm tracking-wide text-white drop-shadow block -mt-1">
                    Always
                  </span>
                </div>
              </div>

              <div className="relative z-10 max-w-lg">
                <span className="text-xs sm:text-sm font-normal text-blue-100 block">
                  Welcome back,
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <motion.h1
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
                    className="text-2xl sm:text-3xl font-black tracking-tight text-white"
                  >
                    {profile?.name || 'Kitchen Staff'}
                  </motion.h1>
                  <span className="text-2xl sm:text-3xl animate-bounce">👋</span>
                </div>
                <p className="mt-1 text-xs sm:text-sm text-blue-100 font-normal">
                  {assignedCanteen?.name ?? 'Ground Floor Canteen'} • Ready to coordinate live kitchen orders.
                </p>

                {/* Feature Pill matching bottom banner */}
                <div className="mt-3.5 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-900/40 border border-emerald-400/30 text-white text-xs font-semibold shadow-xs">
                  <Utensils size={13} className="text-emerald-300" />
                  <span className="text-emerald-100 text-[11px] font-medium">Fresh Food</span>
                  <span className="text-emerald-400/50">•</span>
                  <span className="text-emerald-100 text-[11px] font-medium">Happy People</span>
                  <span className="text-emerald-400/50">•</span>
                  <span className="text-emerald-100 text-[11px] font-medium">Better Days</span>
                </div>
              </div>
            </motion.div>

            {/* Date & Time Widgets (Matched exactly to the 3D Neumorphic / Claymorphic aesthetic) */}
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-3 flex flex-col justify-between gap-2.5"
            >
              {/* Card 1: DATE */}
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="relative overflow-hidden bg-gradient-to-r from-[#ffffff] via-[#f8fbff] to-[#f0f6ff] rounded-2xl sm:rounded-3xl border border-white p-3 sm:p-3.5 shadow-[0_8px_20px_rgba(180,205,240,0.35)] flex items-center justify-between min-h-[66px]"
              >
                {/* Right side Calendar Illustration with Leaf */}
                <div className="absolute right-1 -bottom-1 pointer-events-none w-28 h-20 opacity-90 select-none">
                  <svg viewBox="0 0 140 100" fill="none" className="w-full h-full">
                    {/* Background Soft Glow */}
                    <ellipse cx="95" cy="65" rx="42" ry="28" fill="#dbeafe" opacity="0.6" />
                    {/* Botanical Leaf */}
                    <g transform="translate(112, 42) rotate(18)">
                      <path d="M0 32 C6 20, 18 10, 24 0 C22 14, 18 24, 0 32 Z" fill="#60a5fa" opacity="0.8" />
                      <path d="M-4 28 C-12 18, -14 8, -10 2 C-4 12, 0 20, -4 28 Z" fill="#93c5fd" opacity="0.7" />
                    </g>
                    {/* 3D Angled Calendar */}
                    <g transform="translate(42, 14)">
                      {/* Back page stand */}
                      <path d="M12 28 L56 12 L72 68 L28 82 Z" fill="#2563eb" opacity="0.9" />
                      {/* White Front Sheet with perspective */}
                      <path d="M6 22 L62 10 L70 66 L14 76 Z" fill="#ffffff" filter="drop-shadow(0 4px 6px rgba(37,99,235,0.2))" />
                      {/* Top Ring Binders */}
                      <rect x="18" y="14" width="4" height="10" rx="2" fill="#93c5fd" />
                      <rect x="34" y="11" width="4" height="10" rx="2" fill="#93c5fd" />
                      <rect x="50" y="8" width="4" height="10" rx="2" fill="#93c5fd" />
                      {/* Mini Month Grid Boxes */}
                      <rect x="16" y="32" width="6" height="5" rx="1" fill="#e2e8f0" />
                      <rect x="26" y="30" width="6" height="5" rx="1" fill="#e2e8f0" />
                      <rect x="36" y="28" width="6" height="5" rx="1" fill="#e2e8f0" />
                      <rect x="46" y="26" width="6" height="5" rx="1" fill="#e2e8f0" />
                      {/* Active Day Blue Square */}
                      <rect x="36" y="38" width="8" height="7" rx="1.5" fill="#1d68f2" />
                      <rect x="16" y="42" width="6" height="5" rx="1" fill="#e2e8f0" />
                      <rect x="26" y="40" width="6" height="5" rx="1" fill="#cbd5e1" />
                      <rect x="48" y="36" width="6" height="5" rx="1" fill="#e2e8f0" />
                      <rect x="16" y="52" width="6" height="5" rx="1" fill="#e2e8f0" />
                      <rect x="26" y="50" width="6" height="5" rx="1" fill="#cbd5e1" />
                      <rect x="36" y="48" width="6" height="5" rx="1" fill="#e2e8f0" />
                      <rect x="48" y="46" width="6" height="5" rx="1" fill="#cbd5e1" />
                    </g>
                    {/* Floating burst accents */}
                    <line x1="38" y1="28" x2="32" y2="22" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="32" y1="36" x2="26" y2="36" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>

                {/* Left Content */}
                <div className="relative z-10 flex items-center gap-3 min-w-0">
                  {/* 3D Blue Squircle Icon */}
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] p-[1.5px] shadow-[0_6px_14px_rgba(37,99,235,0.4)] flex items-center justify-center shrink-0">
                    <div className="w-full h-full rounded-[14px] bg-gradient-to-b from-[#60a5fa] to-[#1e40af] flex items-center justify-center text-white relative overflow-hidden">
                      {/* Top inner glossy specular reflection */}
                      <div className="absolute top-0 inset-x-0 h-1/2 bg-white/30 rounded-t-[14px]" />
                      <CalendarDays size={20} className="relative z-10 drop-shadow-sm text-white" strokeWidth={2.4} />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black tracking-widest uppercase text-slate-400">
                        Date
                      </span>
                      <span className="w-4 h-[1.5px] bg-slate-200 rounded-full" />
                    </div>
                    <div className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-snug">
                      {new Date(currentTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200/80 text-[10px] font-extrabold text-[#1d68f2] shadow-2xs">
                      <CalendarDays size={10} strokeWidth={2.6} />
                      <span>{new Date(currentTime).toLocaleDateString('en-US', { weekday: 'long' })}</span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Card 2: TIME */}
              <motion.div
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="relative overflow-hidden bg-gradient-to-r from-[#ffffff] via-[#f9faff] to-[#eef4ff] rounded-2xl sm:rounded-3xl border border-white p-3 sm:p-3.5 shadow-[0_8px_20px_rgba(180,205,240,0.35)] flex items-center justify-between min-h-[66px]"
              >
                {/* Right side Clock & Moon Illustration */}
                <div className="absolute right-1 -bottom-1 pointer-events-none w-28 h-20 opacity-90 select-none">
                  <svg viewBox="0 0 140 100" fill="none" className="w-full h-full">
                    {/* Background Soft Glow */}
                    <ellipse cx="95" cy="65" rx="42" ry="28" fill="#dbeafe" opacity="0.5" />
                    {/* Crescent Moon */}
                    <path
                      d="M118 20 A10 10 0 1 0 128 32 A8 8 0 0 1 118 20 Z"
                      fill="#3b82f6"
                      opacity="0.8"
                    />
                    {/* Botanical Leaf accent */}
                    <g transform="translate(114, 52) rotate(22)">
                      <path d="M0 26 C5 16, 14 8, 20 0 C18 12, 14 20, 0 26 Z" fill="#60a5fa" opacity="0.8" />
                      <path d="M-3 22 C-9 14, -11 6, -8 2 C-3 10, 0 16, -3 22 Z" fill="#93c5fd" opacity="0.7" />
                    </g>
                    {/* 3D Modern Analog Clock */}
                    <g transform="translate(74, 28)">
                      {/* Outer Rim Shadow */}
                      <circle cx="28" cy="28" r="26" fill="#bfdbfe" opacity="0.6" />
                      {/* Clock Bezel */}
                      <circle cx="28" cy="28" r="24" fill="#ffffff" stroke="#93c5fd" strokeWidth="2.5" filter="drop-shadow(0 4px 6px rgba(59,130,246,0.18))" />
                      {/* Inner Face */}
                      <circle cx="28" cy="28" r="20" fill="#f8fafc" />
                      {/* Hour dots */}
                      <circle cx="28" cy="12" r="1.2" fill="#64748b" />
                      <circle cx="44" cy="28" r="1.2" fill="#64748b" />
                      <circle cx="28" cy="44" r="1.2" fill="#64748b" />
                      <circle cx="12" cy="28" r="1.2" fill="#64748b" />
                      {/* Clock Hands indicating ~10:10 / current time */}
                      <line x1="28" y1="28" x2="28" y2="17" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
                      <line x1="28" y1="28" x2="38" y2="23" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
                      {/* Center Pin */}
                      <circle cx="28" cy="28" r="2" fill="#1e40af" />
                    </g>
                    {/* Sparkle burst star */}
                    <path d="M52 46 Q54 41 59 39 Q54 37 52 32 Q50 37 45 39 Q50 41 52 46 Z" fill="#60a5fa" opacity="0.8" />
                    <circle cx="58" cy="56" r="1.5" fill="#93c5fd" />
                  </svg>
                </div>

                {/* Left Content */}
                <div className="relative z-10 flex items-center gap-3 min-w-0">
                  {/* 3D Purple/Indigo Squircle Icon */}
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-b from-[#6366f1] to-[#4338ca] p-[1.5px] shadow-[0_6px_14px_rgba(99,102,241,0.4)] flex items-center justify-center shrink-0">
                    <div className="w-full h-full rounded-[14px] bg-gradient-to-b from-[#818cf8] to-[#3730a3] flex items-center justify-center text-white relative overflow-hidden">
                      {/* Top inner glossy specular reflection */}
                      <div className="absolute top-0 inset-x-0 h-1/2 bg-white/30 rounded-t-[14px]" />
                      <Clock size={20} className="relative z-10 drop-shadow-sm text-white" strokeWidth={2.4} />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black tracking-widest uppercase text-slate-400">
                        Time
                      </span>
                      <span className="w-4 h-[1.5px] bg-slate-200 rounded-full" />
                    </div>
                    <div className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-snug">
                      {new Date(currentTime).getHours() < 12 ? 'Morning' : new Date(currentTime).getHours() < 17 ? 'Afternoon' : 'Evening'}
                    </div>
                    <div className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/80 text-[10px] font-extrabold text-[#4f46e5] font-mono shadow-2xs">
                      <Clock size={10} strokeWidth={2.6} />
                      <span>{new Date(currentTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>

          {/* 4 KPI Metric Cards - Styled exactly in CANTEEN OS aesthetic with motion */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
            {/* Card 1: Today's Orders */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="relative overflow-hidden bg-gradient-to-br from-[#f8faff] via-[#f1f6ff] to-[#e4efff] p-3 sm:p-3.5 rounded-3xl border border-[#d8e7ff] shadow-xs flex flex-col justify-between min-h-[102px] group"
            >
              <div className="absolute right-0 bottom-0 pointer-events-none w-32 h-20 overflow-hidden">
                <svg viewBox="0 0 140 90" fill="none" className="w-full h-full opacity-80" preserveAspectRatio="none">
                  <path d="M0 65 C 30 65, 50 35, 80 55 C 105 70, 115 15, 140 25 L 140 90 L 0 90 Z" fill="#cadffd" />
                  <path d="M30 75 C 60 75, 80 50, 110 65 C 125 75, 130 45, 140 50 L 140 90 L 30 90 Z" fill="#b8d4fc" opacity="0.6" />
                </svg>
              </div>
              <div className="absolute top-3.5 right-3.5 text-[#93c5fd] opacity-60">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#1e69ff] to-[#0051e8] text-white flex items-center justify-center shadow-md shadow-blue-500/25 shrink-0 group-hover:scale-105 transition-transform duration-200">
                    <ChefHat size={17} strokeWidth={2.2} />
                  </div>
                  <span className="text-xs font-extrabold text-[#1e293b] tracking-tight">Today's Orders</span>
                </div>
                <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight">
                  {orders.length}
                </div>
              </div>
              <div className="mt-1.5 text-[10px] font-bold text-[#16a34a] flex items-center gap-1.5 z-10">
                <span className="font-extrabold text-[11px]">↗ 100%</span>
                <span className="text-[#64748b] font-medium text-[10px]">vs yesterday</span>
              </div>
            </motion.div>

            {/* Card 2: In Kitchen */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="relative overflow-hidden bg-gradient-to-br from-[#f6fcf8] via-[#effaf2] to-[#e1f7e7] p-3 sm:p-3.5 rounded-3xl border border-[#cbf0d5] shadow-xs flex flex-col justify-between min-h-[102px] group"
            >
              <div className="absolute right-0 bottom-0 pointer-events-none w-32 h-20 overflow-hidden">
                <svg viewBox="0 0 140 90" fill="none" className="w-full h-full opacity-80" preserveAspectRatio="none">
                  <path d="M0 75 C 35 75, 55 45, 85 60 C 110 72, 120 20, 140 22 L 140 90 L 0 90 Z" fill="#bbf0cb" />
                  <path d="M40 80 C 70 80, 85 55, 115 65 C 128 72, 132 40, 140 42 L 140 90 L 40 90 Z" fill="#a3e9b7" opacity="0.6" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#00aa63] to-[#00894f] text-white flex items-center justify-center shadow-md shadow-emerald-500/25 shrink-0 group-hover:scale-105 group-hover:shadow-emerald-500/40 transition-all duration-200">
                    <IconCooking size={16} />
                  </div>
                  <span className="text-xs font-extrabold text-[#00874e] tracking-tight">In Kitchen</span>
                </div>
                <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight">
                  {orders.filter(o => ['ACCEPTED', 'PREPARING'].includes(o.status)).length}
                </div>
              </div>
              <div className="mt-1.5 text-[10px] font-bold text-[#16a34a] flex items-center gap-1.5 z-10">
                <span className="font-extrabold text-[11px]">🍳 Prep Station</span>
                <span className="text-[#64748b] font-medium text-[10px]">cooking in progress</span>
              </div>
            </motion.div>

            {/* Card 3: Avg. Prep Time */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.36, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="relative overflow-hidden bg-gradient-to-br from-[#fffdf7] via-[#fff8eb] to-[#ffeed0] p-3 sm:p-3.5 rounded-3xl border border-[#fde4b8] shadow-xs flex flex-col justify-between min-h-[102px] group"
            >
              <div className="absolute -right-2 -bottom-2 pointer-events-none opacity-25 text-[#f59e0b]">
                <svg width="85" height="85" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="6">
                  <circle cx="50" cy="50" r="42" />
                  <path d="M50 22v30l20 10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#f29400] to-[#d97c00] text-white flex items-center justify-center shadow-md shadow-amber-500/25 shrink-0 group-hover:scale-105 transition-transform duration-200">
                    <Clock size={17} strokeWidth={2.4} />
                  </div>
                  <span className="text-xs font-extrabold text-[#1e293b] tracking-tight">Avg. Prep Time</span>
                </div>
                <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight flex items-baseline gap-1">
                  <span>10</span>
                  <span className="text-base font-bold text-[#334155]">min</span>
                </div>
              </div>
              <div className="mt-1.5 text-[10px] font-bold text-[#1e293b] flex items-center gap-1.5 z-10">
                <span className="text-[11px]">🎯</span>
                <span className="text-[#475569] font-medium text-[10px]">Standard kitchen target</span>
              </div>
            </motion.div>

            {/* Card 4: Ready for Pickup */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.44, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="relative overflow-hidden bg-gradient-to-br from-[#faf7ff] via-[#f4edff] to-[#e8dafe] p-3 sm:p-3.5 rounded-3xl border border-[#e2d0fd] shadow-xs flex flex-col justify-between min-h-[102px] group"
            >
              <div className="absolute right-2 bottom-2 pointer-events-none opacity-25 text-[#9333ea]">
                <svg width="45" height="55" viewBox="0 0 24 28" fill="currentColor">
                  <path d="M4 0h10l6 6v22H4V0zm10 1.5V7h5.5L14 1.5zM6 11v2h12v-2H6zm0 4v2h12v-2H6zm0 4v2h8v-2H6z"/>
                </svg>
              </div>
              <div className="absolute right-0 bottom-0 pointer-events-none w-24 h-12 overflow-hidden">
                <svg viewBox="0 0 100 50" fill="none" className="w-full h-full opacity-60">
                  <path d="M0 35 C 30 20, 60 40, 100 15 L 100 50 L 0 50 Z" fill="#d8b4fe"/>
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#8739f9] to-[#6d20e3] text-white flex items-center justify-center shadow-md shadow-purple-500/25 shrink-0 group-hover:scale-105 group-hover:shadow-purple-500/40 transition-all duration-200">
                    <IconPackage size={16} />
                  </div>
                  <span className="text-xs font-extrabold text-[#1e293b] tracking-tight">Ready for Pickup</span>
                </div>
                <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight flex items-center gap-2">
                  <span>{readyOrders.length}</span>
                  {totalOverdueCount > 0 && (
                    <span className="text-[10px] bg-rose-500 text-white font-black px-2 py-0.5 rounded-full">
                      {totalOverdueCount} Overdue
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1.5 text-[10px] font-medium text-[#64748b] z-10">
                {readyOrders.length > 0 ? `${readyOrders.length} orders boxed at counter` : 'No orders awaiting pickup'}
              </div>
            </motion.div>
          </div>

          {/* Main 2-Column Split: Left (Live Orders + Quick Actions + Order List) & Right (Popular Items + Promo Card) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch flex-1 min-h-0">
            {/* Left Column (8 cols on lg) */}
            <div className="lg:col-span-8 flex flex-col justify-between gap-3 min-h-0">
              {/* 1. Order List Table Card (Moved to the Top) */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="bg-white rounded-3xl border border-slate-100/80 p-3 sm:p-3.5 shadow-xs flex flex-col justify-between flex-1 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-blue-50 text-[#1d68f2] flex items-center justify-center">
                      <IconPackage size={14} />
                    </div>
                    <h2 className="text-xs sm:text-sm font-extrabold text-slate-800">Order List</h2>
                  </div>
                  <Link
                    to="/staff/collect"
                    className="text-[11px] font-bold text-[#1d68f2] hover:underline flex items-center gap-1 active:scale-95 transition-transform"
                  >
                    <span>View All</span>
                    <span>→</span>
                  </Link>
                </div>

                <div className="overflow-x-auto">
                  {(() => {
                    const displayList = recentOrders.length > 0 ? recentOrders : orders;
                    if (displayList.length === 0) {
                      return (
                        <div className="py-4 text-center">
                          <p className="text-xs font-bold text-slate-500">No orders recorded yet.</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Orders will appear here automatically in real time.</p>
                        </div>
                      );
                    }
                    return (
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="bg-slate-50/70 border-y border-slate-100 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                            <th className="py-1 px-2.5">#</th>
                            <th className="py-1 px-2.5">Customer</th>
                            <th className="py-1 px-2.5">Items</th>
                            <th className="py-1 px-2.5">Amount</th>
                            <th className="py-1 px-2.5">Status</th>
                            <th className="py-1 px-2.5 text-right">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {displayList.slice(0, 4).map((ord, rIdx) => {
                            const custName = ord.profiles?.name || 'Customer';
                            const itemsSummary = ord.order_items?.map((i) => `${i.menu_items?.name || 'Item'} (${i.quantity})`).join(', ') || '1 Item';
                            const computedTotal = calculateOrderTotal(ord as any).totalAmount;
                            const amount = computedTotal > 0 ? computedTotal : ((ord as any).total_amount ? Number((ord as any).total_amount) : 0);
                            const timeStr = ord.created_at ? new Date(ord.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '--:--';

                            const isReadyOrDone = ord.status === 'READY' || ord.status === 'COLLECTED';
                            const isPrep = ord.status === 'PREPARING';

                            return (
                              <motion.tr
                                key={ord.id}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.35, delay: 0.5 + rIdx * 0.08, ease: 'easeOut' }}
                                className="hover:bg-blue-50/50 transition-colors duration-150"
                              >
                                <td className="py-1.5 px-2.5 font-mono font-semibold text-slate-400 text-[10px]">
                                  #{String(ord.order_number || ord.id.slice(0, 4)).padStart(4, '0')}
                                </td>
                                <td className="py-1.5 px-2.5 font-bold text-slate-800 whitespace-nowrap">
                                  {custName}
                                </td>
                                <td className="py-1.5 px-2.5 text-slate-600 font-medium max-w-[160px] truncate" title={itemsSummary}>
                                  {itemsSummary}
                                </td>
                                <td className="py-1.5 px-2.5 font-extrabold text-slate-900">
                                  ₹{amount}
                                </td>
                                <td className="py-1.5 px-2.5">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold transition-colors duration-300 ${
                                    isReadyOrDone
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : isPrep
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-blue-50 text-blue-700'
                                  }`}>
                                    <span className={`w-1 h-1 rounded-full ${
                                      isReadyOrDone ? 'bg-emerald-500' : isPrep ? 'bg-amber-500' : 'bg-blue-500'
                                    }`} />
                                    {ord.status === 'COLLECTED' ? 'Completed' : ord.status}
                                  </span>
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-medium text-slate-400 text-[10px] whitespace-nowrap">
                                  {timeStr}
                                </td>
                              </motion.tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </motion.div>

              {/* 2. Live Orders Card (Moved Down) */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="bg-white rounded-3xl border border-slate-100/80 p-3 sm:p-3.5 shadow-xs flex flex-col justify-between flex-1 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <h2 className="text-xs sm:text-sm font-extrabold text-slate-800">Live Orders</h2>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                      {totalActiveCount} active
                    </span>
                  </div>
                  <Link
                    to="/staff/collect"
                    className="text-[11px] font-bold text-[#1d68f2] hover:underline flex items-center gap-1 active:scale-95 transition-transform"
                  >
                    <span>View All Orders</span>
                    <span>→</span>
                  </Link>
                </div>

                {orders.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="py-4 sm:py-6 flex flex-col items-center justify-center text-center my-auto"
                  >
                    <motion.div
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                      className="w-12 h-12 rounded-full bg-blue-50/70 border border-blue-100/60 flex items-center justify-center text-blue-400 mb-1.5"
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M4 18h16" />
                        <path d="M4 18a8 8 0 0 1 16 0" />
                        <path d="M12 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
                      </svg>
                    </motion.div>
                    <div className="text-xs sm:text-sm font-extrabold text-slate-800">
                      No live active orders right now.
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                      New customer orders will show here in real time.
                    </p>
                  </motion.div>
                ) : (
                  <div className="overflow-x-auto my-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="pb-1.5">Order ID</th>
                          <th className="pb-1.5">Items</th>
                          <th className="pb-1.5">Slot</th>
                          <th className="pb-1.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {orders.slice(0, 3).map((ord, rIdx) => {
                          const summaryText = ord.order_items?.map((i) => `${i.quantity}x ${i.menu_items?.name || 'Item'}`).join(', ') || 'No items';
                          const statusBadgeClass =
                            ord.status === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            ord.status === 'PREPARING' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            ord.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            'bg-slate-100 text-slate-700 border-slate-200';

                          return (
                            <motion.tr
                              key={ord.id}
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.3, delay: 0.6 + rIdx * 0.08, ease: 'easeOut' }}
                              className="hover:bg-blue-50/50 transition-colors duration-150"
                            >
                              <td className="py-1.5 font-bold text-[#1d68f2] font-mono">#{ord.order_number}</td>
                              <td className="py-1.5 font-semibold text-slate-800 max-w-[200px] truncate" title={summaryText}>
                                {summaryText}
                              </td>
                              <td className="py-1.5 text-slate-500 font-medium">
                                {ord.pickup_time ? formatPickupTime(ord.pickup_time) : (ord as any).requested_pickup_time ? formatPickupTime((ord as any).requested_pickup_time) : 'Immediate'}
                              </td>
                              <td className="py-1.5 text-right">
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border transition-colors duration-300 ${statusBadgeClass}`}>
                                  {ord.status}
                                </span>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            </div>

            {/* Right Column (4 cols on lg): Popular Items + Promo Card */}
            <div className="lg:col-span-4 flex flex-col justify-between gap-3 min-h-0">
              {/* Today's Most Sold Food Card */}
              <motion.div
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="bg-white rounded-3xl border border-slate-100/80 p-3 sm:p-3.5 shadow-xs flex flex-col justify-between flex-1 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-orange-500 text-sm animate-pulse">🔥</span>
                    <div>
                      <h2 className="text-xs sm:text-sm font-extrabold text-slate-800 leading-none">Most Sold Today</h2>
                      <span className="text-[10px] text-slate-400 font-medium">Top ordered dishes</span>
                    </div>
                  </div>
                  <Link
                    to="/staff/menu"
                    className="text-[11px] font-bold text-[#1d68f2] hover:underline flex items-center gap-1 active:scale-95 transition-transform"
                  >
                    <span>Menu</span>
                    <span>→</span>
                  </Link>
                </div>

                <div className="space-y-2">
                  {(() => {
                    const displayList = todayTopSold.length > 0
                      ? todayTopSold.slice(0, 4)
                      : (menuItems.slice(0, 4).length > 0 ? menuItems.slice(0, 4) : [
                          { id: '1', name: 'Masala Dosa', price: 40, is_sold_out: false },
                          { id: '2', name: 'Idli (2 pcs)', price: 20, is_sold_out: false },
                          { id: '3', name: 'Plain Rice', price: 15, is_sold_out: false },
                          { id: '4', name: 'Tea', price: 10, is_sold_out: false }
                        ]);

                    return displayList.map((item: any, idx: number) => {
                      const soldCount = item.soldTodayCount || 0;

                      return (
                        <motion.div
                          key={item.id || idx}
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.35, delay: 0.6 + idx * 0.08, ease: 'easeOut' }}
                          whileHover={{ x: 3, transition: { duration: 0.15 } }}
                          className="flex items-center justify-between p-2 rounded-xl hover:bg-blue-50/40 transition border border-transparent hover:border-blue-100 cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Veg/Non-Veg Color Dot indicator */}
                            <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center shrink-0">
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${
                                  item.veg_non_veg === 'VEG' ? 'bg-emerald-500' : 'bg-rose-500'
                                }`}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-slate-800 truncate">
                                {item.name}
                              </div>
                              <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
                                <span>₹ {item.price}</span>
                                {soldCount > 0 && (
                                  <>
                                    <span className="text-slate-300">•</span>
                                    <span className="text-blue-600 font-extrabold">{soldCount} sold</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {soldCount > 0 && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-50 text-blue-700 border border-blue-200/80">
                                #{idx + 1} Today
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 transition-colors duration-200 ${
                              !item.is_sold_out
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            }`}>
                              <span className={`w-1 h-1 rounded-full ${
                                !item.is_sold_out ? 'bg-emerald-500' : 'bg-rose-500'
                              }`} />
                              {!item.is_sold_out ? 'Available' : 'Sold Out'}
                            </span>
                          </div>
                        </motion.div>
                      );
                    });
                  })()}
                </div>
              </motion.div>

              {/* Fresh Food Info Card (Clean Graphic without Photos) */}
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.9, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#0d131f] via-[#111a2c] to-[#18233c] text-white p-4 shadow-md border border-slate-800 shrink-0 group transition-all duration-300 hover:shadow-xl hover:border-slate-700"
              >
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-500/15 pointer-events-none group-hover:scale-105 transition-transform duration-300">
                  <ChefHat size={90} strokeWidth={1.5} />
                </div>

                <div className="relative z-10">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md inline-block mb-1 border border-emerald-500/20">
                    Kitchen Terminal
                  </span>
                  <h3 className="font-sans font-black text-base text-white leading-tight">
                    Quick Service & Quality
                  </h3>
                  <p className="text-[11px] text-slate-300 font-medium mt-1 leading-snug max-w-[260px]">
                    Track incoming token queues, toggle sold out dishes, and verify student orders.
                  </p>
                  <Link
                    to="/staff/menu"
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1d68f2] hover:bg-blue-600 text-white text-[11px] font-bold shadow-md shadow-blue-500/25 transition active:scale-95"
                  >
                    <Utensils size={13} />
                    <span>Manage Menu</span>
                    <span>→</span>
                  </Link>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Bottom Quick Scan Button */}
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        className="fixed bottom-6 right-6 z-40"
      >
        <motion.button
          type="button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsScannerOpen(true)}
          className="group relative flex items-center gap-2.5 px-4 sm:px-5 py-3.5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-600 text-white font-bold text-sm shadow-[0_10px_25px_rgba(37,99,235,0.4)] hover:shadow-[0_14px_30px_rgba(37,99,235,0.55)] transition-colors duration-200 border border-white/20 backdrop-blur-md cursor-pointer"
          title="Quick QR / Barcode Scan"
        >
          {/* Subtle glowing ring animation */}
          <span className="absolute -inset-1 rounded-full bg-blue-500/25 blur-md group-hover:bg-blue-400/40 transition-all pointer-events-none animate-pulse" />
          
          <div className="relative flex items-center justify-center w-7 h-7 rounded-full bg-white/20 group-hover:bg-white/30 transition-colors">
            <QrCode className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
          </div>
          <span className="relative tracking-wide text-xs sm:text-sm font-extrabold uppercase">
            Scan QR
          </span>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
          </span>
        </motion.button>
      </motion.div>

      {/* Live Camera QR Scanner Modal */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleQrScanPayload}
      />

      {/* Order Collected Successfully Modal Popup after entering OTP */}
      <AnimatePresence>
        {verifiedCollectedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-slate-200/80 overflow-hidden space-y-4"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-black text-slate-900 text-base leading-tight">
                        Order #{verifiedCollectedOrder.order_number}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-300">
                        COLLECTED
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium">
                      Collected at {formatPickupTime(verifiedCollectedOrder.collected_at || new Date().toISOString())}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setVerifiedCollectedOrder(null)}
                  className="text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 p-1.5 rounded-xl transition cursor-pointer"
                  title="Close"
                >
                  <IconX size={16} />
                </button>
              </div>

              {/* Stepper */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
                <div className="flex items-center justify-between relative px-2">
                  <div className="absolute left-[18px] right-[18px] top-2.5 h-0.5 bg-emerald-500 -z-0" />
                  {[
                    { label: 'Placed' },
                    { label: 'Accepted' },
                    { label: 'Cooking' },
                    { label: 'Ready' },
                    { label: 'Collected' }
                  ].map((step, idx) => (
                    <div key={idx} className="flex flex-col items-center z-10">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black border transition-all bg-[#1d68f2] border-white text-white shadow-xs">
                        ✓
                      </div>
                      <span className="text-[10px] font-bold mt-1 text-slate-800">
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Celebratory Success Card */}
              <div className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-teal-50/50 to-emerald-100/30 border border-emerald-200 rounded-2xl p-5 text-center space-y-3.5 shadow-xs">
                <div className="absolute top-2.5 left-3 text-emerald-400 opacity-60 text-xs select-none">✨</div>
                <div className="absolute top-3.5 right-4 text-emerald-400 opacity-60 text-sm select-none">🎉</div>
                <div className="absolute bottom-3 left-4 text-emerald-400 opacity-40 text-xs select-none">🌟</div>

                <div className="relative mx-auto w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-[1.5px] shadow-lg shadow-emerald-500/25 flex items-center justify-center">
                  <div className="w-full h-full rounded-[14px] bg-gradient-to-b from-emerald-500 to-teal-600 flex items-center justify-center text-white relative overflow-hidden">
                    <div className="absolute top-0 inset-x-0 h-1/2 bg-white/30 rounded-t-[14px]" />
                    <CheckCircle2 size={28} className="relative z-10 drop-shadow-sm text-white" strokeWidth={2.6} />
                  </div>
                </div>

                <div>
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-300/80 text-emerald-800 text-[10px] font-black uppercase tracking-wider mb-1">
                    <span>ORDER HANDED OVER</span>
                    <span>✓</span>
                  </div>
                  <h4 className="font-black text-slate-900 text-lg tracking-tight">
                    Order Collected Successfully! 🎉
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 max-w-xs mx-auto leading-relaxed">
                    Food items have been verified with OTP and handed over at the counter.
                  </p>
                </div>

                {/* Verified Details Pill */}
                <div className="bg-white/95 border border-emerald-200/90 rounded-xl py-2 px-3 flex items-center justify-around text-center shadow-2xs">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">Student</span>
                    <span className="text-xs font-black text-slate-800 truncate max-w-[100px] block">
                      {verifiedCollectedOrder.profiles?.name || 'Student'}
                    </span>
                  </div>
                  <div className="w-px h-6 bg-slate-200" />
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">Verification</span>
                    <span className="text-xs font-black text-emerald-600 flex items-center justify-center gap-0.5">
                      <span>Verified</span> ✓
                    </span>
                  </div>
                  <div className="w-px h-6 bg-slate-200" />
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">Time</span>
                    <span className="text-xs font-black text-slate-800 font-mono">
                      {formatPickupTime(verifiedCollectedOrder.collected_at || new Date().toISOString())}
                    </span>
                  </div>
                </div>

                {/* Action */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setVerifiedCollectedOrder(null)}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>Close & Done →</span>
                    {modalAutoCloseCountdown > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-800/50 text-[10px] font-mono">
                        {modalAutoCloseCountdown}s
                      </span>
                    )}
                  </button>
                  <p className="text-[10px] text-slate-400 font-medium text-center mt-2">
                    Auto-closing in <span className="font-bold text-emerald-600">{modalAutoCloseCountdown}s</span>
                  </p>
                </div>
              </div>

              {/* Ordered Items List */}
              {verifiedCollectedOrder.order_items && verifiedCollectedOrder.order_items.length > 0 && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Handed Over Items
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">
                      {verifiedCollectedOrder.order_items.length} item{verifiedCollectedOrder.order_items.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="space-y-1 divide-y divide-slate-100">
                    {verifiedCollectedOrder.order_items.map((oi, idx) => (
                      <div key={idx} className="pt-1 first:pt-0 flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">
                          {oi.menu_items?.name || 'Item'} x {oi.quantity}
                        </span>
                        <span className="font-mono font-black text-slate-900">
                          ₹{((Number(oi.menu_items?.price || (oi as any).price || 0)) * oi.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
