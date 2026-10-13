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
import { LayoutList } from 'lucide-react';

type Order = Database['public']['Tables']['orders']['Row'];
type OrderItem = Database['public']['Tables']['order_items']['Row'];
type MenuItem = Database['public']['Tables']['menu_items']['Row'];

// Extended Order type to include joined data (student name, items)
type OrderWithDetails = Order & {
  profiles: { name: string, id_number: string } | null;
  order_items: (OrderItem & { menu_items: MenuItem | null })[];
};

export default function StaffDashboard() {
  const { profile, signOut } = useAuth();
  const { showAlert, showConfirm } = useDialog();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Filtering & View State
  const [selectedSlot, setSelectedSlot] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'KANBAN' | 'GRID' | 'LIST'>('KANBAN');
  const [compactKanban, setCompactKanban] = useState<boolean>(false);
  const [sortByPrepStart, setSortByPrepStart] = useState<boolean>(true);
  const [showBatchSummary, setShowBatchSummary] = useState<boolean>(true);
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

  const { data: assignedCanteen } = useQuery({
    queryKey: ['staffCanteen', profile?.canteen_id],
    queryFn: async () => {
      if (!profile?.canteen_id) return null;
      const { data } = await supabase
        .from('canteens')
        .select('*')
        .eq('id', profile.canteen_id)
        .maybeSingle();
      return data;
    },
    enabled: !!profile?.canteen_id,
  });

  useEffect(() => {
    if (!profile?.canteen_id) {
      setLoading(false);
      return;
    }

    fetchOrders();
    fetchMenu();

    fetchLunchSlotConfig(profile.canteen_id).then(cfg => {
      setConfiguredSlots(generateSlotsFromConfig(cfg));
    });

    const handleConfigUpdate = (e: any) => {
      if (e.detail) {
        setConfiguredSlots(generateSlotsFromConfig(e.detail));
      }
    };
    window.addEventListener('lunch_slot_config_updated', handleConfigUpdate);

    // Realtime subscriptions strictly locked to this staff member's assigned canteen
    const orderSub = supabase.channel(`staff_orders_${profile.canteen_id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `canteen_id=eq.${profile.canteen_id}`
      }, () => {
        fetchOrders();
      })
      .subscribe();

    const menuSub = supabase.channel(`staff_menu_${profile.canteen_id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'menu_items',
        filter: `canteen_id=eq.${profile.canteen_id}`
      }, () => {
        fetchMenu();
      })
      .subscribe();

    const slotSub = supabase.channel(`staff_slots_${profile.canteen_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'lunch_slot_configs',
        filter: `canteen_id=eq.${profile.canteen_id}`
      }, () => {
        fetchLunchSlotConfig(profile.canteen_id).then(cfg => {
          setConfiguredSlots(generateSlotsFromConfig(cfg));
        });
      })
      .subscribe();

    return () => {
      window.removeEventListener('lunch_slot_config_updated', handleConfigUpdate);
      orderSub.unsubscribe();
      menuSub.unsubscribe();
      slotSub.unsubscribe();
    };
  }, [profile?.canteen_id]);

  const fetchMenu = async () => {
    if (!profile?.canteen_id) {
      setMenuItems([]);
      return;
    }
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('canteen_id', profile.canteen_id)
      .order('veg_non_veg', { ascending: false })
      .order('name');
    if (data) {
      const sorted = [...data].sort((a, b) => {
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

  const fetchOrders = async () => {
    if (!profile?.canteen_id) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        profiles ( name, id_number ),
        order_items (
          *,
          menu_items ( * )
        )
      `)
      .eq('canteen_id', profile.canteen_id)
      .in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])
      .order('pickup_time', { ascending: true })
      .order('order_number', { ascending: true });
      
    if (data) setOrders(data as OrderWithDetails[]);
    setLoading(false);
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    // Optimistic update for instant UI feedback
    setOrders(prev => prev.map(order => 
      order.id === orderId ? { ...order, status: status as any } : order
    ));

    const { error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_status: status as any
    });

    if (error) {
      if (import.meta.env.DEV) console.error("Failed to update order status:", error);
      showAlert({
        title: 'Status Update Failed',
        message: 'Failed to update order status. Please try again.',
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
    const { data, error } = await supabase.rpc('verify_pickup_otp', {
      p_order_id: orderId,
      p_otp: codeToVerify
    });

    if (error) {
      if (import.meta.env.DEV) console.error("verify_pickup_otp failed:", error);
      showAlert({
        title: 'Verification Error',
        message: `Verification failed: ${error.message || JSON.stringify(error)}`,
        type: 'error'
      });
      return false;
    }

    const result = data as any;
    if (result.success) {
      setSelectedOrderForOtp(null);
      setOtpInput('');
      fetchOrders();
      return true;
    } else {
      if (result.requires_override) {
        const overrideConfirmed = await showConfirm({
          title: 'Manual Override',
          message: result.message + "\n\nDo you want to manually override?",
          confirmText: 'Override',
          cancelText: 'Cancel',
          isDangerous: true
        });
        if (overrideConfirmed) {
          await supabase.rpc('verify_pickup_otp', {
            p_order_id: orderId,
            p_otp: '',
            p_is_override: true
          });
          setSelectedOrderForOtp(null);
          setOtpInput('');
          fetchOrders();
          return true;
        }
      } else {
        showAlert({
          title: 'Verification Rejected',
          message: result.message,
          type: 'warning'
        });
      }
      return false;
    }
  };

  const handleQuickOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = quickOtpInput.trim();
    if (cleanOtp.length !== 6) return;

    setQuickOtpLoading(true);
    setQuickOtpToast(null);

    // Find the matching order in READY status (or any active order)
    const matchingOrder = orders.find(o => o.otp_code === cleanOtp);
    if (!matchingOrder) {
      setQuickOtpToast({
        message: `No active order found matching OTP ${cleanOtp}. Please verify the code.`,
        isError: true
      });
      setQuickOtpLoading(false);
      return;
    }

    // Readiness Check (Still Preparing / Placed)
    if (matchingOrder.status !== 'READY') {
      setQuickOtpToast({
        message: `⚠️ NOT READY: Order #${matchingOrder.order_number} is currently in status "${matchingOrder.status}". Please mark it as 'READY' first.`,
        isError: true
      });
      setQuickOtpLoading(false);
      return;
    }

    const success = await handleVerifyOtp(matchingOrder.id, cleanOtp);
    if (success) {
      setQuickOtpToast({
        message: `Order #${matchingOrder.order_number} for ${matchingOrder.profiles?.name || 'Student'} verified and collected!`,
        isError: false
      });
      setQuickOtpInput('');
    } else {
      setQuickOtpToast({
        message: `Verification rejected for Order #${matchingOrder.order_number}.`,
        isError: true
      });
    }
    setQuickOtpLoading(false);

    // Clear toast message after 5 seconds
    setTimeout(() => {
      setQuickOtpToast(null);
    }, 5000);
  };

  // QR Code Scanner Payload Handler (Hardened with Anti-Replay & Status Gate)
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
    } else if (cleanPayload.length === 6 && /^\d+$/.test(cleanPayload)) {
      // 6-digit OTP code scanned directly
      otpCodeToVerify = cleanPayload;
      const match = orders.find(o => o.otp_code === cleanPayload);
      if (match) orderIdToVerify = match.id;
    }

    if (!orderIdToVerify) {
      playErrorBuzzer();
      setQuickOtpToast({
        message: `Invalid or unrecognized QR code format: "${cleanPayload}".`,
        isError: true
      });
      return false;
    }

    const matchingOrder = orders.find(o => o.id === orderIdToVerify);
    const orderNum = matchingOrder?.order_number ? `#${matchingOrder.order_number}` : '';
    const studentName = matchingOrder?.profiles?.name || 'Student';

    // 1. Anti-Replay Attack Check (Already Collected)
    if (matchingOrder && matchingOrder.status === 'COLLECTED') {
      playErrorBuzzer();
      setQuickOtpToast({
        message: `⚠️ REPLAY BLOCKED: Order ${orderNum} for ${studentName} was ALREADY collected!`,
        isError: true
      });
      return false;
    }

    // 2. Kitchen Readiness Check (Still Preparing / Placed)
    if (matchingOrder && matchingOrder.status !== 'READY') {
      playErrorBuzzer();
      setQuickOtpToast({
        message: `⚠️ NOT READY: Order ${orderNum} is currently in status "${matchingOrder.status}". Kitchen has not boxed it yet.`,
        isError: true
      });
      return false;
    }

    // 3. Perform atomic verification via RPC
    const success = await handleVerifyOtp(orderIdToVerify, otpCodeToVerify);
    if (success) {
      playSuccessBeep();
      setQuickOtpToast({
        message: `✅ QR Verified! Order ${orderNum} for ${studentName} collected successfully!`,
        isError: false
      });
      return true;
    } else {
      playErrorBuzzer();
      setQuickOtpToast({
        message: `❌ QR verification rejected for order ${orderNum}.`,
        isError: true
      });
      return false;
    }
  };

  const handleMarkNoShow = async (order: OrderWithDetails) => {
    const studentName = order.profiles?.name || 'the student';
    const confirmed = await showConfirm({
      title: 'Mark No-Show & Issue Strike',
      message: `Mark Order #${order.order_number} for ${studentName} as a No-Show?\n\n• The order will be cancelled (REJECTED).\n• ${studentName} will receive 1 Strike.\n• If this is their 2nd strike, their account will be deactivated for 3 days.`,
      confirmText: 'Confirm Strike',
      cancelText: 'Keep Order',
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
        message: `Order cancelled. ${studentName} has reached 2 strikes and their account is now DEACTIVATED for 3 days.`,
        type: 'danger'
      });
    } else {
      showAlert({
        title: 'Strike Issued',
        message: `Order cancelled. Strike added to ${studentName} (Total strikes: ${result.strike_count}/2).`,
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

    // 4. OTP:
    // Safe access: order.otp_code could be null/undefined. Preserves leading zeros.
    const otpStr = String(order.otp_code ?? '').trim().toLowerCase();
    const queryOtpClean = trimmed.replace(/^(otp|code|token)\s*[:#\s]*/i, '').trim();
    const matchesOtp = (
      otpStr.length > 0 &&
      (otpStr.includes(trimmed) || (queryOtpClean.length > 0 && otpStr.includes(queryOtpClean)))
    );

    // 5. Order UUID / ID:
    const matchesId = (order.id || '').toLowerCase().includes(trimmed);

    return (
      matchesOrderNum ||
      matchesOrderNumDigits ||
      matchesName ||
      matchesStudentId ||
      matchesOtp ||
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

  // Filter orders by Slot and Search Query, and sort by Planned Prep Start Time sequence
  const filteredOrders = useMemo(() => {
    const matched = orders.filter(order => {
      // Slot filtering
      if (selectedSlot !== 'ALL') {
        const orderTime = (order as any).requested_pickup_time || order.pickup_time || '';
        if (orderTime !== selectedSlot && !orderTime.startsWith(selectedSlot)) {
          return false;
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
  }, [orders, selectedSlot, searchQuery, sortByPrepStart]);

  // Count of matches found in other slots when a specific slot filter is active
  const otherSlotMatchesCount = useMemo(() => {
    if (!searchQuery.trim() || selectedSlot === 'ALL') return 0;
    return allSlotMatches.length - filteredOrders.length;
  }, [allSlotMatches, filteredOrders, searchQuery, selectedSlot]);

  // Group filtered orders by status columns
  const placedOrders = useMemo(() => filteredOrders.filter(o => o.status === 'PLACED'), [filteredOrders]);
  const kitchenOrders = useMemo(() => filteredOrders.filter(o => ['ACCEPTED', 'PREPARING'].includes(o.status)), [filteredOrders]);
  const readyOrders = useMemo(() => filteredOrders.filter(o => o.status === 'READY'), [filteredOrders]);

  // Compute live order counts per lunch slot
  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      const orderTime = o.pickup_time || '';
      // Direct count
      counts[orderTime] = (counts[orderTime] || 0) + 1;
      // Also credit matching configured tab if orderTime starts with slot value
      activeLunchSlots.forEach(s => {
        if (orderTime !== s.value && orderTime.startsWith(s.value)) {
          counts[s.value] = (counts[s.value] || 0) + 1;
        }
      });
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
        className={`bg-white border rounded-2xl p-4 shadow-sm flex flex-col transition-all hover:shadow-md ${
          overdueInfo.isOverdue ? 'border-amber-400 ring-2 ring-amber-100 bg-amber-50/20' : 'border-slate-200'
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
          <div className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wide border shrink-0 ${
            order.status === 'PLACED' ? 'bg-slate-100 text-slate-700 border-slate-300' :
            order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
            order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
            'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {order.status}
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
        {compactKanban ? (
          <div className="my-1.5 flex justify-between items-center bg-slate-50 p-2 rounded-xl border border-slate-100 text-xs">
            <span className="text-slate-700 font-semibold truncate max-w-[180px]">
              {order.order_items.map(i => `${i.quantity}x ${i.menu_items?.name || 'Item'}`).join(', ')}
            </span>
            <span className="text-indigo-600 font-extrabold text-xs ml-2 shrink-0">
              ₹{order.order_items.reduce((sum, item) => sum + (Number(item.menu_items?.price || 0) * item.quantity), 0).toFixed(0)}
            </span>
          </div>
        ) : (
          <div className="flex-grow my-1">
            <ul className="space-y-1">
              {order.order_items.map(item => (
                <li key={item.id} className="text-xs flex justify-between items-center text-slate-700">
                  <span className="truncate">
                    <span className="font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded mr-1.5">{item.quantity}x</span>
                    {item.menu_items?.name}
                  </span>
                  {item.menu_items?.price !== undefined && item.menu_items?.price !== null && (
                    <span className="text-[11px] text-slate-400 font-medium ml-2 shrink-0">
                      ₹{(Number(item.menu_items.price) * item.quantity).toFixed(0)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 pt-1.5 border-t border-dashed border-slate-100 flex justify-between items-center text-[11px] font-bold text-slate-500">
              <span>Total Value</span>
              <span className="text-indigo-600 font-extrabold text-xs">
                ₹{order.order_items.reduce((sum, item) => sum + (Number(item.menu_items?.price || 0) * item.quantity), 0).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col gap-1.5">
          {order.status === 'PLACED' && (
            <div className="flex gap-2">
              <button 
                onClick={() => updateOrderStatus(order.id, 'ACCEPTED')} 
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-1.5 rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                Accept Order
              </button>
              <button 
                onClick={() => updateOrderStatus(order.id, 'REJECTED')} 
                className="px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 py-1.5 rounded-xl text-xs font-bold transition-colors border border-rose-200"
              >
                Reject
              </button>
            </div>
          )}

          {order.status === 'ACCEPTED' && (
            <button 
              onClick={() => updateOrderStatus(order.id, 'PREPARING')} 
              className="w-full bg-orange-500 hover:bg-orange-600 text-white py-1.5 rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5"
            >
              <IconCooking size={14} className="w-3.5 h-3.5" />
              <span>Start Preparing</span>
            </button>
          )}

          {order.status === 'PREPARING' && (
            <button 
              onClick={() => updateOrderStatus(order.id, 'READY')} 
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5"
            >
              <IconCheckCircle size={14} className="w-3.5 h-3.5" />
              <span>Mark Ready for Pickup</span>
            </button>
          )}

          {order.status === 'READY' && (
            <div className="flex flex-col gap-1.5">
              {selectedOrderForOtp === order.id ? (
                <div className="flex gap-1.5 items-center">
                  <input 
                    type="text" 
                    placeholder="OTP" 
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    autoComplete="off"
                    maxLength={6}
                    className="w-20 px-2 py-1.5 border border-slate-300 rounded-xl text-center font-mono tracking-widest text-xs focus:ring-2 focus:ring-indigo-500 text-slate-900"
                  />
                  <button 
                    onClick={() => handleVerifyOtp(order.id)} 
                    className="flex-1 bg-slate-900 text-white py-1.5 rounded-xl text-xs font-bold hover:bg-slate-800"
                  >
                    Verify
                  </button>
                  <button 
                    onClick={() => { setSelectedOrderForOtp(null); setOtpInput(''); }} 
                    className="px-2.5 py-1.5 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200 text-xs flex items-center justify-center"
                  >
                    <IconX size={13} className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setSelectedOrderForOtp(order.id)} 
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white py-1.5 rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  <IconKey size={14} className="w-3.5 h-3.5 text-indigo-200" />
                  <span>Verify OTP</span>
                </button>
              )}

              {overdueInfo.isOverdue && (
                <button 
                  onClick={() => handleMarkNoShow(order)} 
                  className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 py-1.5 px-3 rounded-xl text-xs font-bold transition-colors text-center"
                  title="Cancel order and add 1 strike to student"
                >
                  Cancel &amp; Strike (No-Show)
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Guard: unassigned staff
  if (!profile?.canteen_id) {
    return (
      <div className="w-full max-w-2xl mx-auto mt-16 text-center">
        <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-10 flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
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
    <div className="w-full max-w-7xl mx-auto space-y-4 pb-20">
      {/* Top Operations Header */}
      <div className="bg-slate-900 rounded-[2rem] p-5 sm:p-7 text-white shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-500/30">
                Staff Operations Portal
              </span>
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase tracking-wider rounded-full border border-emerald-500/30">
                🏪 Kitchen Terminal: {assignedCanteen?.name ?? 'Ground Floor Canteen'}
              </span>
              <span className="text-xs text-slate-400">Lunch Window: 11:30 AM – 2:30 PM</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-2 leading-tight">
              Order Command Center
            </h1>
          </div>

          {/* Quick Counter Pickup by OTP / QR Scan */}
          <div className="w-full lg:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm shrink-0 active:scale-95 border border-indigo-400/30"
              title="Open camera to scan student's QR code"
            >
              <IconCamera size={16} className="w-4 h-4" />
              <span>Scan QR</span>
            </button>

            <form onSubmit={handleQuickOtpSubmit} className="flex gap-2 bg-slate-800/90 p-1.5 rounded-2xl border border-slate-700 shadow-inner">
              <input
                type="text"
                placeholder="Type 6-Digit OTP..."
                value={quickOtpInput}
                onChange={e => setQuickOtpInput(e.target.value)}
                maxLength={6}
                className="w-36 sm:w-44 px-3 py-2 bg-slate-900 border border-slate-700 text-white font-mono rounded-xl tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm placeholder:text-slate-500 placeholder:tracking-normal placeholder:font-sans"
              />
              <button
                type="submit"
                disabled={quickOtpInput.trim().length !== 6 || quickOtpLoading}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm shrink-0"
              >
                <IconZap size={14} className="w-3.5 h-3.5" />
                <span>{quickOtpLoading ? 'Verifying...' : 'Collect'}</span>
              </button>
            </form>
          </div>
        </div>

        {/* Quick Toast Feedback for Top Bar OTP */}
        {quickOtpToast && (
          <div className={`mt-3 p-3 rounded-xl text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-1 ${
            quickOtpToast.isError 
              ? 'bg-rose-500/20 border border-rose-500/40 text-rose-200' 
              : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-200'
          }`}>
            <span>{quickOtpToast.message}</span>
            <button onClick={() => setQuickOtpToast(null)} className="text-slate-400 hover:text-white p-1">
              <IconX size={14} className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Live Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Active</div>
            <div className="text-2xl font-black text-white mt-0.5">{totalActiveCount}</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Placed (New)</div>
            <div className="text-2xl font-black text-indigo-400 mt-0.5">
              {orders.filter(o => o.status === 'PLACED').length}
            </div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">In Kitchen</div>
            <div className="text-2xl font-black text-orange-400 mt-0.5">
              {orders.filter(o => ['ACCEPTED', 'PREPARING'].includes(o.status)).length}
            </div>
          </div>
          <div className={`rounded-xl p-3 border ${
            totalOverdueCount > 0 
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-200' 
              : 'bg-slate-800/60 border-slate-700/60'
          }`}>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Ready / Overdue</div>
            <div className="text-2xl font-black text-emerald-400 mt-0.5 flex items-center gap-2">
              <span>{orders.filter(o => o.status === 'READY').length}</span>
              {totalOverdueCount > 0 && (
                <span className="text-xs bg-amber-500 text-slate-900 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <IconAlertTriangle size={12} className="w-3 h-3 text-slate-900 shrink-0" />
                  <span>{totalOverdueCount} No-Show</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Control Bar: Slot Filters, Global Search, and View Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        {/* Top Controls: Search Bar & View Mode Switcher */}
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
          {/* Search Bar with Enhanced Contrast & Visibility */}
          <div className="relative flex-1 group">
            <div className="relative flex items-center bg-slate-100 hover:bg-slate-50/80 focus-within:bg-white border-2 border-slate-300 focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-100 rounded-2xl shadow-sm transition-all overflow-hidden px-4 py-2.5 gap-3">
              <IconSearch size={18} className="w-5 h-5 text-indigo-600 shrink-0 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by Order Number, Student Name, Student ID, or OTP..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 placeholder:text-slate-500 placeholder:font-normal border-none outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 p-0 pr-24"
                style={{ caretColor: 'transparent' }}
              />
              <div className="absolute right-2.5 flex items-center gap-1.5">
                {searchQuery && (
                  <>
                    <span className="hidden sm:inline-block px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold rounded-lg">
                      {filteredOrders.length} {filteredOrders.length === 1 ? 'match' : 'matches'}
                    </span>
                    <button 
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors active:scale-95 shadow-sm"
                      title="Clear search query"
                    >
                      <IconX size={12} className="w-3 h-3 text-slate-600" />
                      <span>Clear</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
            <button
              onClick={() => setShowBatchSummary(!showBatchSummary)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors border flex items-center gap-1.5 ${
                showBatchSummary 
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <IconCooking size={14} className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Kitchen Batch Prep</span>
            </button>

            {/* Sort by Planned Prep Start Time Sequence */}
            <button
              onClick={() => setSortByPrepStart(!sortByPrepStart)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                sortByPrepStart
                  ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Sort orders by Planned Preparation Start Time for kitchen cooking sequence"
            >
              <span className={sortByPrepStart ? 'text-amber-600' : 'text-slate-400'}>⚡</span>
              <span>{sortByPrepStart ? 'Prep Sequence' : 'Default Order'}</span>
            </button>

            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setViewMode('KANBAN')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'KANBAN' 
                    ? 'bg-white text-indigo-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <IconKanban size={13} className="w-3.5 h-3.5" />
                <span>Kanban</span>
              </button>
              <button
                onClick={() => setViewMode('GRID')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'GRID' 
                    ? 'bg-white text-indigo-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <IconGrid size={13} className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>
              <button
                onClick={() => setViewMode('LIST')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'LIST' 
                    ? 'bg-white text-indigo-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutList size={13} className="w-3.5 h-3.5" />
                <span>Compact List</span>
              </button>
            </div>

            {viewMode === 'KANBAN' && (
              <button
                onClick={() => setCompactKanban(!compactKanban)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  compactKanban 
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
                title="Toggle card compactness"
              >
                {compactKanban ? 'Dense' : 'Normal'}
              </button>
            )}
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
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <button
            onClick={() => setSelectedSlot('ALL')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all border flex items-center gap-1.5 ${
              selectedSlot === 'ALL'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span>All Slots</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${selectedSlot === 'ALL' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
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
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all border flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : count > 0
                      ? 'bg-indigo-50/70 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                      : 'bg-slate-50 text-slate-400 border-slate-200 opacity-70'
                }`}
              >
                <span>{slot.rangeLabel || slot.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                  isSelected 
                    ? 'bg-indigo-800 text-white' 
                    : count > 0 
                      ? 'bg-indigo-200 text-indigo-900' 
                      : 'bg-slate-200 text-slate-500'
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

      {/* Main Order Pipeline: Kanban vs Grid View */}
      {loading && orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-[2rem] p-12 text-center text-slate-500 shadow-sm">
          Loading live order queue...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-[2rem] p-12 text-center text-slate-500 shadow-sm space-y-3">
          <IconPackage size={38} className="w-10 h-10 text-slate-300 mx-auto" />
          <div className="font-extrabold text-slate-800 text-lg">
            {searchQuery.trim() ? 'No Matching Orders Found' : 'No Orders in Queue'}
          </div>
          <div className="text-sm text-slate-500 max-w-md mx-auto">
            {searchQuery.trim() ? (
              <>
                No active orders matched <span className="font-semibold text-slate-800 font-mono">"{searchQuery}"</span>
                {selectedSlot !== 'ALL' && ` in the ${formatPickupTime(selectedSlot)} slot`}.
                <br />
                <span className="text-xs text-slate-400 mt-1.5 block">
                  Staff can search by Order Number (e.g. #4), Student Name, Student ID (including leading zeros), or 6-digit OTP.
                </span>
              </>
            ) : selectedSlot !== 'ALL' ? (
              `No orders scheduled for the ${formatPickupTime(selectedSlot)} slot.`
            ) : (
              'There are currently no active orders in the kitchen queue.'
            )}
          </div>

          {/* Switch to all slots action if matches exist across other slots */}
          {searchQuery.trim() && otherSlotMatchesCount > 0 && selectedSlot !== 'ALL' && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setSelectedSlot('ALL')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-2 mx-auto"
              >
                <span>View {allSlotMatches.length} matching {allSlotMatches.length === 1 ? 'order' : 'orders'} in All Slots</span>
              </button>
            </div>
          )}

          {(searchQuery || selectedSlot !== 'ALL') && (
            <div className="pt-1">
              <button 
                type="button"
                onClick={() => { setSearchQuery(''); setSelectedSlot('ALL'); }}
                className="text-xs font-bold text-slate-600 hover:text-indigo-600 underline"
              >
                Reset Filters &amp; Clear Search
              </button>
            </div>
          )}
        </div>
      ) : viewMode === 'KANBAN' ? (
        /* 3-Column Kanban Board */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Column 1: Placed / Incoming */}
          <div className="bg-slate-100/80 border border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-col min-h-[300px]">
            <div className="flex justify-between items-center mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
                <h3 className="font-extrabold text-sm text-slate-800 uppercase tracking-wide">
                  Placed (New)
                </h3>
                <span className="bg-slate-200 text-slate-700 text-xs font-black px-2 py-0.5 rounded-full">
                  {placedOrders.length}
                </span>
              </div>
              {placedOrders.length > 1 && (
                <button
                  onClick={() => bulkAcceptOrders(placedOrders.map(o => o.id))}
                  className="text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <IconZap size={12} className="w-3 h-3 text-indigo-600" />
                  <span>Accept All ({placedOrders.length})</span>
                </button>
              )}
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto max-h-[75vh] pr-1">
              {placedOrders.length === 0 ? (
                <div className="text-center text-xs text-slate-400 py-10">No incoming new orders</div>
              ) : (
                placedOrders.map(renderOrderCard)
              )}
            </div>
          </div>

          {/* Column 2: In Kitchen Queue (Accepted & Preparing) */}
          <div className="bg-orange-50/50 border border-orange-200/70 rounded-2xl p-3 sm:p-4 flex flex-col min-h-[300px]">
            <div className="flex justify-between items-center mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
                <h3 className="font-extrabold text-sm text-orange-950 uppercase tracking-wide">
                  Kitchen Queue
                </h3>
                <span className="bg-orange-200 text-orange-900 text-xs font-black px-2 py-0.5 rounded-full">
                  {kitchenOrders.length}
                </span>
              </div>
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto max-h-[75vh] pr-1">
              {kitchenOrders.length === 0 ? (
                <div className="text-center text-xs text-slate-400 py-10">Kitchen queue is clear</div>
              ) : (
                kitchenOrders.map(renderOrderCard)
              )}
            </div>
          </div>

          {/* Column 3: Ready for Collection */}
          <div className="bg-emerald-50/50 border border-emerald-200/70 rounded-2xl p-3 sm:p-4 flex flex-col min-h-[300px]">
            <div className="flex justify-between items-center mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <h3 className="font-extrabold text-sm text-emerald-950 uppercase tracking-wide">
                  Ready at Counter
                </h3>
                <span className="bg-emerald-200 text-emerald-900 text-xs font-black px-2 py-0.5 rounded-full">
                  {readyOrders.length}
                </span>
              </div>
              {readyOrders.some(o => getOrderOverdueInfo(o).isOverdue) && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse flex items-center gap-1">
                  <IconAlertTriangle size={11} className="w-3 h-3 text-amber-700 shrink-0" />
                  <span>No-Show Alerts</span>
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
      ) : viewMode === 'LIST' ? (
        /* High-Density Live Orders Table */
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-3.5">Order #</th>
                  <th className="py-3 px-3.5">Slot / Timing</th>
                  <th className="py-3 px-3.5">Student</th>
                  <th className="py-3 px-3.5">Items</th>
                  <th className="py-3 px-3.5">Status</th>
                  <th className="py-3 px-3.5">Total</th>
                  <th className="py-3 px-3.5 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredOrders.map(order => {
                  const overdueInfo = getOrderOverdueInfo(order);
                  const qrExpired = isQrExpired(order);
                  const totalItems = order.order_items.reduce((sum, i) => sum + i.quantity, 0);
                  const totalAmount = order.order_items.reduce((sum, item) => sum + (Number(item.menu_items?.price || 0) * item.quantity), 0);

                  return (
                    <tr 
                      key={order.id} 
                      className={`hover:bg-slate-50/80 transition-colors ${
                        overdueInfo.isOverdue ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-sm text-slate-900">#{order.order_number}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                            order.is_takeaway ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {order.is_takeaway ? 'TAKEAWAY' : 'DINE'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono block">
                          ID: {order.profiles?.id_number || order.id.split('-')[0].toUpperCase()}
                        </span>
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
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
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">{order.profiles?.name || 'Student'}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{order.profiles?.id_number || 'No ID'}</div>
                      </td>

                      <td className="py-3 px-3.5 max-w-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                            {totalItems}x
                          </span>
                          <span className="text-slate-600 truncate max-w-[200px]" title={order.order_items.map(i => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}>
                            {order.order_items.map(i => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                          order.status === 'PLACED' ? 'bg-slate-100 text-slate-700 border-slate-300' :
                          order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                          'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {order.status}
                        </span>
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap font-extrabold text-slate-800">
                        ₹{totalAmount.toFixed(0)}
                      </td>

                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        {order.status === 'PLACED' && (
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => updateOrderStatus(order.id, 'ACCEPTED')}
                              className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => updateOrderStatus(order.id, 'REJECTED')}
                              className="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}

                        {order.status === 'ACCEPTED' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'PREPARING')}
                            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ml-auto"
                          >
                            <IconCooking size={13} className="w-3.5 h-3.5" />
                            <span>Start Prep</span>
                          </button>
                        )}

                        {order.status === 'PREPARING' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'READY')}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ml-auto"
                          >
                            <IconCheckCircle size={13} className="w-3.5 h-3.5" />
                            <span>Mark Ready</span>
                          </button>
                        )}

                        {order.status === 'READY' && (
                          <div className="flex items-center justify-end gap-1.5">
                            {selectedOrderForOtp === order.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  placeholder="OTP"
                                  value={otpInput}
                                  onChange={(e) => setOtpInput(e.target.value)}
                                  autoComplete="off"
                                  maxLength={6}
                                  className="w-16 px-1.5 py-1 border border-slate-300 rounded-lg text-center font-mono text-xs focus:ring-1 focus:ring-indigo-500 text-slate-900"
                                />
                                <button
                                  onClick={() => handleVerifyOtp(order.id)}
                                  className="px-2 py-1 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800"
                                >
                                  OK
                                </button>
                                <button
                                  onClick={() => { setSelectedOrderForOtp(null); setOtpInput(''); }}
                                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                                >
                                  <IconX size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setSelectedOrderForOtp(order.id)}
                                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                              >
                                <IconKey size={13} className="w-3 h-3 text-indigo-300" />
                                <span>Verify</span>
                              </button>
                            )}

                            {overdueInfo.isOverdue && (
                              <button
                                onClick={() => handleMarkNoShow(order)}
                                className="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors"
                                title="Issue strike to student"
                              >
                                Strike
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Compact Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map(renderOrderCard)}
        </div>
      )}

      {/* Quick Menu Item Availability Section */}
      <div className="bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-7 shadow-sm mt-6">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h3 className="font-extrabold text-xl text-slate-800">Quick Menu Availability</h3>
            <p className="text-xs text-slate-500 mt-0.5">Toggle sold out status instantaneously across student devices</p>
          </div>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            {menuItems.filter(m => !m.is_sold_out).length} / {menuItems.length} Available
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {menuItems.map(item => (
            <div 
              key={item.id} 
              className={`flex flex-col justify-between p-3.5 rounded-2xl border transition-all text-center ${
                item.is_sold_out ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              <div>
                <div className="flex items-center justify-center gap-1.5 mb-1.5">
                  <span className={`w-2 h-2 rounded-full ${item.veg_non_veg === 'VEG' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">{item.veg_non_veg === 'VEG' ? 'Veg' : 'Non-Veg'}</span>
                </div>
                <div className={`text-xs font-bold leading-tight ${item.is_sold_out ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {item.name}
                </div>
                <div className="text-[11px] font-extrabold text-indigo-600 mt-1">₹{Number(item.price || 0).toFixed(0)}</div>
              </div>

              <button 
                onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
                className={`mt-3 w-full text-[11px] py-1.5 rounded-xl font-bold transition-transform active:scale-95 border ${
                  item.is_sold_out 
                    ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 border-slate-300' 
                    : 'bg-rose-50 text-rose-600 hover:bg-rose-100 border-rose-200'
                }`}
              >
                {item.is_sold_out ? 'Mark Available' : 'Sold Out'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Live Camera QR Scanner Modal */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleQrScanPayload}
      />
    </div>
  );
}
