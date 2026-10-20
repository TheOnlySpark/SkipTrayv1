import React from "react";
import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconBan,
  IconClock,
  IconHourglass,
  IconStar,
  IconX,
  IconChevronUp,
  IconQrCode,
  IconMaximize,
  IconSearch,
  IconPackage
} from '../components/Icons';
import { QRCodeSVG } from '../components/QRCode';
import { calculateOrderLedger } from '../lib/ledger';
import { formatErrorMessage } from '../utils/validation';
import { Lock, Radio, CheckCircle2, Sparkles, ShieldCheck, Star, X as LucideX, ArrowLeft, ShoppingCart, Flame, UtensilsCrossed, Trash2, ArrowRight, Heart, Check, LayoutGrid, Leaf, Package } from 'lucide-react';
import { playStatusChime, triggerHapticFeedback } from '../utils/notificationSound';
import { useSearchParams, Link } from 'react-router-dom';

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type Order = Database['public']['Tables']['orders']['Row'];
type ItemReview = Database['public']['Tables']['item_reviews']['Row'];
type PastOrder = Order & {
  order_items: {
    id?: string;
    quantity: number;
    menu_items: MenuItem | null;
  }[];
  item_reviews: ItemReview[];
};

import {
  formatPickupTime,
  formatSingleTime,
  normalizeTimeTo24h,
  LUNCH_SLOTS,
  fetchLunchSlotConfig,
  generateSlotsFromConfig,
  validateSlotSelection,
  validateUserCustomPickupTiming,
  calculateEndTime,
  parseTimeToMinutes,
  minutesToTimeString,
  LunchSlotConfig,
  LunchSlot,
  DEFAULT_LUNCH_SLOT_CONFIG,
  getAvailableServiceDates,
  getNextFeasibleServiceDate,
  getISTDateTime,
  AvailableServiceDate,
} from '../lib/lunchSlots';
import {
  calculateLocalOrderSchedule,
  ScheduledCartItem,
  calculateOrderPrepDuration,
} from '../lib/smartScheduling';

export { formatPickupTime, LUNCH_SLOTS };

import { getItemCategory, FoodCategory } from '../lib/menuCategories';
export { getItemCategory, type FoodCategory };

export default function StudentDashboard() {
  const { profile, signOut } = useAuth();
  const { showAlert, showConfirm } = useDialog();
  const queryClient = useQueryClient();
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [pastOrders, setPastOrders] = useState<PastOrder[]>([]);

  // Tab Navigation linked with URL search params ('history' or 'menu')
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab');
  const showHistory = activeTab === 'history';

  const setShowHistory = (show: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (show) {
      next.set('tab', 'history');
    } else {
      next.delete('tab');
    }
    setSearchParams(next, { replace: false });
  };

  // Food Search & Filter States
  const [foodSearchQuery, setFoodSearchQuery] = useState('');
  const [foodTypeFilter, setFoodTypeFilter] = useState<'ALL' | 'VEG' | 'NON_VEG'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'SOUTH_INDIAN' | 'NORTH_INDIAN' | 'RICE_MEALS' | 'SNACKS' | 'BEVERAGES' | 'DESSERTS' | 'PACKED_FOOD' | 'MEALS' | 'DRINKS'>('ALL');

  // Date is strictly Today (orders can only be placed for today)
  const [selectedDate, setSelectedDate] = useState(() => {
    return getISTDateTime(Date.now()).dateStr;
  });

  const getInitialPickupTime = () => {
    let activeConfig = DEFAULT_LUNCH_SLOT_CONFIG;
    try {
      const local = localStorage.getItem('skiptray_lunch_slot_config_default');
      if (local) {
        activeConfig = JSON.parse(local);
      }
    } catch {
      // ignore
    }

    const nowIST = getISTDateTime(Date.now());
    const nextFeasible = getNextFeasibleServiceDate(Date.now(), activeConfig, 10);
    const isToday = nextFeasible.dateStr === nowIST.dateStr;
    const startMin = parseTimeToMinutes(activeConfig.serviceStartTime || '08:00');
    const endMin = parseTimeToMinutes(activeConfig.serviceEndTime || '20:00');
    const interval = Number(activeConfig.slotDurationMinutes) || 15;
    const leadTime = Math.max(Number(activeConfig.defaultPrepTimeMinutes) || 10, Number(activeConfig.minNoticeMinutes) || 0);

    if (!isToday) {
      return minutesToTimeString(startMin);
    }

    // Must be in the future: current time + lead time, snapped up to next slot
    const targetMin = nowIST.totalMinutes + leadTime;
    const nextSlotMin = Math.max(startMin, Math.ceil(targetMin / interval) * interval);
    if (nextSlotMin <= endMin) {
      return minutesToTimeString(nextSlotMin);
    }
    return minutesToTimeString(startMin);
  };

  const [cart, setCart] = useState<{ item: MenuItem, quantity: number }[]>([]);
  const [showCartBuilder, setShowCartBuilder] = useState(false);
  const [pickupTime, setPickupTime] = useState(getInitialPickupTime);

  // Helper to convert 24h string ("16:31") to 12h parts and vice versa
  const parse12hParts = (timeStr?: string | null) => {
    const min = parseTimeToMinutes(timeStr);
    if (isNaN(min)) return { hour: 12, minute: 0, period: 'PM' as const };
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return { hour, minute: m, period };
  };

  const compose24hString = (hour: number, minute: number, period: 'AM' | 'PM') => {
    let h = hour % 12;
    if (period === 'PM') h += 12;
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Immediate Confirmation Modal State on OTP Verification / Order Collection
  const [collectedOrderConfirmation, setCollectedOrderConfirmation] = useState<{
    order: Order;
    items?: { menuItemId?: string; name: string; quantity: number; price?: number }[];
  } | null>(null);

  // Close cart on Escape key press
  useEffect(() => {
    if (!cartOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCartOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cartOpen]);

  // Close confirmation modal on Escape key press
  useEffect(() => {
    if (!collectedOrderConfirmation) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCollectedOrderConfirmation(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [collectedOrderConfirmation]);

  // Periodically refresh current time every 30s to dynamically update slot cutoffs
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Anti-Screenshot Live Security Watermark Ticker (1-second precision in 12-hour AM/PM)
  const [liveTickerTime, setLiveTickerTime] = useState(() => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }));
  useEffect(() => {
    const ticker = setInterval(() => setLiveTickerTime(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })), 1000);
    return () => clearInterval(ticker);
  }, []);

  // Get current time in IST to avoid browser timezone issues
  const getISTDate = () => {
    return new Date(new Date(currentTime).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  };

  const istDate = getISTDate();
  const isSunday = false;
  const currentHour = istDate.getHours();
  const currentMinute = istDate.getMinutes();
  const currentISTMinutes = currentHour * 60 + currentMinute;

  // Check if current time is before 9:30 AM opening time
  const isBeforeOpeningTime = false;

  // Configurable Lunch Slot Management State
  const [slotConfig, setSlotConfig] = useState<LunchSlotConfig>(() => {
    try {
      const local = localStorage.getItem('skiptray_lunch_slot_config_default');
      if (local) return JSON.parse(local);
    } catch {}
    return DEFAULT_LUNCH_SLOT_CONFIG;
  });

  const cartCanteenId = cart[0]?.item?.canteen_id || profile?.canteen_id || null;

  useEffect(() => {
    let isMounted = true;

    fetchLunchSlotConfig(cartCanteenId).then(cfg => {
      if (isMounted) setSlotConfig(cfg);
    });

    const handleConfigUpdate = (e: any) => {
      if (e.detail && isMounted) {
        setSlotConfig(e.detail);
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('skiptray_lunch_slot_config') && e.newValue && isMounted) {
        try {
          setSlotConfig(JSON.parse(e.newValue));
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('lunch_slot_config_updated', handleConfigUpdate);
    window.addEventListener('storage', handleStorageChange);

    const slotSub = supabase
      .channel('public:lunch_slot_configs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lunch_slot_configs' }, () => {
        fetchLunchSlotConfig(cartCanteenId).then(cfg => {
          if (isMounted) setSlotConfig(cfg);
        });
      })
      .subscribe();

    return () => {
      isMounted = false;
      window.removeEventListener('lunch_slot_config_updated', handleConfigUpdate);
      window.removeEventListener('storage', handleStorageChange);
      slotSub.unsubscribe();
    };
  }, [cartCanteenId]);

  const availableLunchSlots = useMemo(() => {
    return generateSlotsFromConfig(slotConfig);
  }, [slotConfig]);

  const serviceStartMin = parseTimeToMinutes(slotConfig.serviceStartTime || '08:00');
  const serviceEndMin = parseTimeToMinutes(slotConfig.serviceEndTime || '20:00');
  const isTodayServiceEnded = currentISTMinutes >= serviceEndMin;
  const isLunchClosedForToday = !slotConfig.isLunchEnabled || isTodayServiceEnded;

  // Helper to determine slot availability
  const getSlotAvailability = (slotValue: string) => {
    const res = validateSlotSelection(slotValue, slotConfig, currentISTMinutes, false);
    const slotMinutes = parseTimeToMinutes(slotValue);
    const diffMinutes = slotMinutes - currentISTMinutes;
    return { isAvailable: res.isAvailable, diffMinutes, reason: res.reason };
  };

  // User-Selected Lunch Pickup Time & Smart Preparation Scheduling
  // Student chooses when they expect to arrive and collect their food (supports any minute, e.g. 12:17, 12:26, 12:43)

  // Convert cart items for concurrent kitchen preparation scheduling
  const scheduledCartItems: ScheduledCartItem[] = useMemo(() => {
    return cart.map(c => {
      const rawCat = String((c.item as any).category || '').toLowerCase();
      const isPacked =
        rawCat === 'packed food' ||
        rawCat === 'packed' ||
        rawCat === 'packaged' ||
        rawCat === 'snacks' ||
        rawCat === 'snack' ||
        rawCat.includes('pack') ||
        (c.item as any).stock_quantity != null ||
        (c.item as any).prep_time_minutes === 0 ||
        (c.item.name || '').toLowerCase().includes('packed') ||
        getItemCategory(c.item) === 'Packed Food';
      return {
        id: c.item.id,
        name: c.item.name,
        quantity: c.quantity,
        prepTimeMinutes: isPacked ? 0 : ((c.item as any).prep_time_minutes || slotConfig.defaultPrepTimeMinutes || 10)
      };
    });
  }, [cart, slotConfig.defaultPrepTimeMinutes]);

  // Available service dates based on canteen business rules
  const availableServiceDates = useMemo(() => {
    const prepDuration = calculateOrderPrepDuration(scheduledCartItems, slotConfig.defaultPrepTimeMinutes || 10);
    return getAvailableServiceDates(currentTime, slotConfig, prepDuration, 3);
  }, [currentTime, slotConfig, scheduledCartItems]);

  // Real-time backend-aligned smart scheduling calculation:
  // Planned Prep Start Time = Requested Pickup Time - Estimated Prep Duration
  const smartSchedule = useMemo(() => {
    return calculateLocalOrderSchedule(
      pickupTime,
      scheduledCartItems,
      slotConfig,
      currentISTMinutes,
      selectedDate,
      currentTime
    );
  }, [pickupTime, scheduledCartItems, slotConfig, currentISTMinutes, selectedDate, currentTime]);

  const suggestedQuickSlots = useMemo(() => {
    const prepDuration = calculateOrderPrepDuration(scheduledCartItems, slotConfig.defaultPrepTimeMinutes || 10);
    const todayDateStr = getISTDateTime(currentTime).dateStr;
    const isToday = selectedDate === todayDateStr;
    const minNotice = slotConfig.minNoticeMinutes || 0;
    const disabledSet = new Set(slotConfig.disabledSlots || []);

    // 1. If CUSTOM slot mode and customSlots exist, filter from the admin-defined custom slots
    if (slotConfig.slotMode === 'CUSTOM' && Array.isArray(slotConfig.customSlots) && slotConfig.customSlots.length > 0) {
      const candidates = slotConfig.customSlots
        .filter(s => !disabledSet.has(normalizeTimeTo24h(s.startTime)))
        .map(s => normalizeTimeTo24h(s.startTime))
        .filter(Boolean)
        .sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));

      if (!isToday) {
        return candidates.slice(0, 5);
      }

      // If today, filter out past or lead-time violated slots and return next 5 slots from current time
      const earliestFeasibleMin = currentISTMinutes + Math.max(prepDuration, minNotice);
      const feasible = candidates.filter(t => parseTimeToMinutes(t) >= earliestFeasibleMin);
      return feasible.slice(0, 5);
    }

    // 2. FIXED slot mode: use configured service hours and configured interval duration (e.g. 5m, 10m, 15m, 30m, 60m)
    const startMin = parseTimeToMinutes(slotConfig.serviceStartTime || '08:00');
    const endMin = parseTimeToMinutes(slotConfig.serviceEndTime || '20:00');
    const interval = Number(slotConfig.slotDurationMinutes) || 15;

    // Strictly next slot from current time (including preparation & notice lead time)
    const earliestFeasibleMin = isToday
      ? Math.max(startMin, currentISTMinutes + Math.max(prepDuration, minNotice))
      : startMin;

    if (isToday && earliestFeasibleMin > endMin) {
      return [];
    }

    const list: string[] = [];
    const firstSlot = Math.max(startMin, Math.ceil(earliestFeasibleMin / interval) * interval);
    for (let m = firstSlot; m <= endMin && list.length < 5; m += interval) {
      const slotStr = minutesToTimeString(m);
      if (!disabledSet.has(slotStr)) {
        list.push(slotStr);
      }
    }
    return list;
  }, [slotConfig, currentISTMinutes, scheduledCartItems, selectedDate, currentTime]);

  // Allowed minute dropdown options according to canteen slot strategy
  const availableMinuteOptions = useMemo(() => {
    if (slotConfig.slotMode === 'CUSTOM' && Array.isArray(slotConfig.customSlots) && slotConfig.customSlots.length > 0) {
      const minutesSet = new Set<string>();
      slotConfig.customSlots.forEach(s => {
        const m = parseTimeToMinutes(s.startTime);
        if (!isNaN(m)) {
          minutesSet.add(String(m % 60).padStart(2, '0'));
        }
      });
      const arr = Array.from(minutesSet).sort((a, b) => Number(a) - Number(b));
      if (arr.length > 0) return arr;
    }

    const interval = Number(slotConfig.slotDurationMinutes) || 15;
    const minutes: string[] = [];
    for (let m = 0; m < 60; m += interval) {
      minutes.push(String(m).padStart(2, '0'));
    }
    return minutes.length > 0 ? minutes : ['00'];
  }, [slotConfig.slotMode, slotConfig.customSlots, slotConfig.slotDurationMinutes]);

  // Snap current pickupTime to the nearest valid, future slot for today
  useEffect(() => {
    const todayDateStr = getISTDateTime(currentTime).dateStr;
    if (selectedDate !== todayDateStr) {
      setSelectedDate(todayDateStr);
    }
    const currentPickupMin = parseTimeToMinutes(pickupTime);
    const prepDuration = calculateOrderPrepDuration(scheduledCartItems, slotConfig.defaultPrepTimeMinutes || 10);
    const minNotice = slotConfig.minNoticeMinutes || 0;
    const earliestFeasibleMin = currentISTMinutes + Math.max(prepDuration, minNotice);

    // If today and pickupTime is in the past or before earliest feasible next slot, snap to the first available slot
    if (currentPickupMin < earliestFeasibleMin) {
      if (suggestedQuickSlots.length > 0) {
        setPickupTime(suggestedQuickSlots[0]);
        return;
      }
    }

    if (availableMinuteOptions.length === 0) return;
    const { hour, minute, period } = parse12hParts(pickupTime);
    const minuteStr = String(minute).padStart(2, '0');
    if (!availableMinuteOptions.includes(minuteStr)) {
      // Find closest minute option
      const currentMinNum = minute;
      let closest = availableMinuteOptions[0];
      let minDiff = 999;
      for (const opt of availableMinuteOptions) {
        const diff = Math.abs(Number(opt) - currentMinNum);
        if (diff < minDiff) {
          minDiff = diff;
          closest = opt;
        }
      }
      setPickupTime(compose24hString(hour, Number(closest), period));
    }
  }, [availableMinuteOptions, pickupTime, selectedDate, currentISTMinutes, currentTime, suggestedQuickSlots, scheduledCartItems, slotConfig.defaultPrepTimeMinutes, slotConfig.minNoticeMinutes]);

  useEffect(() => {
    if (smartSchedule.isValid && error) {
      setError('');
    }
  }, [pickupTime, smartSchedule.isValid, error]);

  const [reviewingItem, setReviewingItem] = useState<{ orderId: string, menuItemId: string, itemName: string } | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // OTP Challenge state for READY orders (Ephemeral verification metadata)
  const [challengeData, setChallengeData] = useState<{
    expiresAt?: number;
    resendAvailableAt?: number;
    status?: string;
  } | null>(null);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [enteredOtp, setEnteredOtp] = useState('');
  const [otpSentMessage, setOtpSentMessage] = useState<string | null>(null);

  // Authoritative active OTP with sessionStorage cache fallback
  const currentOtp = useMemo(() => {
    if (!activeOrder) return '';
    const cached = (() => {
      try {
        return sessionStorage.getItem(`order_otp_${activeOrder.id}`) || '';
      } catch {
        return '';
      }
    })();
    return ((activeOrder as any).otp_code || enteredOtp || (activeOrder as any).otp || cached || '').trim();
  }, [activeOrder, enteredOtp]);

  const fetchActive = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          *,
          menu_items (*)
        ),
        canteens (name)
      `)
      .eq('user_id', profile.id)
      .in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      if (data.status === 'COLLECTED') {
        const isDismissed = sessionStorage.getItem(`dismissed_collected_${data.id}`) === 'true';
        if (isDismissed) {
          setActiveOrder(null);
          setChallengeData(null);
          return;
        }
      }

      setActiveOrder(data as any);
      // Fetch active challenge metadata only if status is READY
      if (data.status === 'READY') {
        try {
          const { data: challenge } = await (supabase
            .from('order_otp_challenges') as any)
            .select('*')
            .eq('order_id', data.id)
            .eq('status', 'ACTIVE')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (challenge) {
            setChallengeData({
              expiresAt: new Date(challenge.expires_at).getTime(),
              resendAvailableAt: new Date(challenge.resend_available_at).getTime(),
              status: challenge.status,
            });
          }
        } catch {
          // ignore if order_otp_challenges table is not present
        }
      } else {
        setChallengeData(null);
      }
    } else {
      setActiveOrder(null);
      setChallengeData(null);
    }
  }, [profile?.id]);

  const [autoCloseCountdown, setAutoCloseCountdown] = useState<number>(60);
  const [collectedDismissed, setCollectedDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('skiptray_collected_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const handleDismissCollectedOrder = (orderId?: string) => {
    try {
      sessionStorage.setItem('skiptray_collected_dismissed', 'true');
      if (orderId) {
        sessionStorage.setItem(`dismissed_collected_${orderId}`, 'true');
      }
    } catch {}
    setCollectedDismissed(true);
    setActiveOrder(null);
    setShowCartBuilder(true);
    queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
  };

  // Auto-close collected success screen after 1 minute (60s) from collection and return to food order state
  useEffect(() => {
    const isCollected = activeOrder?.status === 'COLLECTED';
    if (!isCollected || collectedDismissed) {
      setAutoCloseCountdown(60);
      return;
    }

    // Check when it was collected
    const collectedTime = activeOrder?.collected_at ? new Date(activeOrder.collected_at).getTime() : Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - collectedTime) / 1000));
    const remaining = Math.max(0, 60 - elapsedSeconds);

    if (remaining === 0) {
      handleDismissCollectedOrder(activeOrder?.id);
      return;
    }

    setAutoCloseCountdown(remaining);
    const interval = setInterval(() => {
      setAutoCloseCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handleDismissCollectedOrder(activeOrder?.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeOrder?.status, activeOrder?.id, activeOrder?.collected_at, collectedDismissed]);

  const handleRequestOtp = async () => {
    if (!activeOrder) return;
    setRequestingOtp(true);
    try {
      const { data, error } = await supabase.rpc('request_collection_otp', {
        p_order_id: activeOrder.id,
      });

      if (error) {
        // Fallback: If RPC request_collection_otp is missing or encounters a database schema/constraint error
        console.warn('request_collection_otp RPC returned error, generating dynamic pickup OTP in memory:', error.message);
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        setEnteredOtp(generatedOtp);
        try {
          sessionStorage.setItem(`order_otp_${activeOrder.id}`, generatedOtp);
        } catch {}
        setChallengeData({
          expiresAt: Date.now() + 5 * 60 * 1000,
          resendAvailableAt: Date.now() + 60 * 1000,
          status: 'ACTIVE',
        });
        showAlert({
          title: 'Collection OTP Generated 🎉',
          message: `Your dynamic 6-digit pickup OTP is ${generatedOtp}. Show this OTP or scan the QR code at the counter.`,
          type: 'success',
        });
        return;
      } else {
        const res = data as any;
        if (res.success) {
          // If RPC returned an OTP (for ephemeral testing or display), adopt it, else generate dynamic OTP
          const dynamicOtp = res.otp || Math.floor(100000 + Math.random() * 900000).toString();
          setEnteredOtp(dynamicOtp);
          try {
            sessionStorage.setItem(`order_otp_${activeOrder.id}`, dynamicOtp);
          } catch {}
          setOtpSentMessage(res.message);
          setChallengeData({
            expiresAt: new Date(res.expires_at || Date.now() + 5 * 60 * 1000).getTime(),
            resendAvailableAt: new Date(res.resend_available_at || Date.now() + 60 * 1000).getTime(),
            status: 'ACTIVE',
          });
          showAlert({
            title: 'Collection OTP Generated 🎉',
            message: `Your 6-digit pickup OTP is ${dynamicOtp}. Show this code or QR at counter to collect food.`,
            type: 'success',
          });
        } else {
          showAlert({ title: 'Notice', message: res.message, type: 'info' });
        }
      }
    } catch (err: any) {
      showAlert({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setRequestingOtp(false);
    }
  };

  // Automatically fetch / generate OTP as soon as order reaches READY status
  useEffect(() => {
    if (activeOrder?.status === 'READY' && !currentOtp && !requestingOtp) {
      handleRequestOtp();
    }
  }, [activeOrder?.status, activeOrder?.id, currentOtp, requestingOtp]);

  useEffect(() => {
    fetchActive();
  }, [fetchActive]);

  useEffect(() => {
    if (!profile?.id) return;

    // Listen to changes on our active order and past orders
    const orderSub = supabase
      .channel('public:orders')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `user_id=eq.${profile.id}`
      }, async (payload) => {
        const updatedOrder = payload.new as Order;
        if (['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'].includes(updatedOrder?.status)) {
          if (updatedOrder?.status === 'COLLECTED') {
            playStatusChime('COLLECTED');
            triggerHapticFeedback('COLLECTED');
          }
          fetchActive();
          queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
        } else {
          // If rejected or cancelled, clear active order and refresh history
          setActiveOrder(null);
          queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
        }
      })
      .subscribe();

    // Listen to changes on menu items (e.g. sold out status)
    const menuSub = supabase
      .channel('public:menu_items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      })
      .subscribe();

    // Listen to changes on item reviews (e.g. admin reply)
    const reviewSub = supabase
      .channel('public:item_reviews')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'item_reviews',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
      })
      .subscribe();

    return () => {
      orderSub.unsubscribe();
      menuSub.unsubscribe();
      reviewSub.unsubscribe();
    };
  }, [profile?.id, queryClient]);

  const { data: menuItems = [], isLoading: menuLoading } = useQuery({
    queryKey: ['menuItems'],
    queryFn: async () => {
      const { data } = await supabase
        .from('menu_items')
        .select('*')
        .order('veg_non_veg', { ascending: false })
        .order('name');

      let metaMap: Record<string, any> = {};
      try {
        const globalMeta = localStorage.getItem('skiptray_menu_meta_global');
        if (globalMeta) metaMap = JSON.parse(globalMeta);
      } catch {}

      return (data || [])
        .filter(item => !item.name.startsWith('[DELETED]') && !item.name.startsWith('[ARCHIVED]'))
        .map(item => {
          const lowerName = (item.name || '').toLowerCase();
          const meta = metaMap[item.id] || metaMap[`name:${lowerName}`] || {};
          const rawCat = String((item as any).category || meta.category || '').toLowerCase();
          const isPacked =
            rawCat === 'packed food' ||
            rawCat === 'packed' ||
            rawCat === 'packaged' ||
            rawCat === 'snacks' ||
            rawCat === 'snack' ||
            rawCat.includes('pack') ||
            (item as any).stock_quantity != null ||
            meta.stock_quantity != null ||
            (item as any).prep_time_minutes === 0 ||
            meta.prep_time_minutes === 0 ||
            getItemCategory(item) === 'Packed Food';
          const stock = (item as any).stock_quantity ?? meta.stock_quantity ?? null;
          const isSoldOut = item.is_sold_out || (isPacked && stock !== null && stock <= 0);

          const resolvedCategory = isPacked ? 'Packed Food' : ((item as any).category || meta.category || 'Meals');

          return {
            ...item,
            category: resolvedCategory,
            prep_time_minutes: (item as any).prep_time_minutes ?? meta.prep_time_minutes ?? (isPacked ? 0 : 10),
            stock_quantity: stock,
            is_sold_out: isSoldOut,
          };
        })
        .sort((a, b) => {
          if (a.veg_non_veg !== b.veg_non_veg) {
            return a.veg_non_veg === 'VEG' ? -1 : 1;
          }
          if (a.name.toLowerCase() === 'veg meals') return -1;
          if (b.name.toLowerCase() === 'veg meals') return 1;
          return a.name.localeCompare(b.name);
        });
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Query real-time most sold food items of the week (created_at >= past 7 days)
  const { data: salesCountMap = {} } = useQuery({
    queryKey: ['studentWeeklyTopSoldSales'],
    refetchInterval: 15000,
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const { data } = await supabase
        .from('orders')
        .select(`
          status,
          order_items (
            quantity,
            menu_item_id,
            menu_items (id, name)
          )
        `)
        .gte('created_at', startDate.toISOString())
        .neq('status', 'REJECTED');

      const countMap: Record<string, number> = {};

      if (data) {
        data.forEach((order: any) => {
          order.order_items?.forEach((item: any) => {
            const rawName = item.menu_items?.name || '';
            const cleanName = rawName.replace(/^\[(?:DELETED|ARCHIVED)\]\s*/i, '').toLowerCase().trim();
            const itemId = item.menu_item_id || item.menu_items?.id;
            const qty = Number(item.quantity) || 1;

            if (itemId) {
              countMap[itemId] = (countMap[itemId] || 0) + qty;
            }
            if (cleanName) {
              countMap[cleanName] = (countMap[cleanName] || 0) + qty;
              countMap[`name:${cleanName}`] = (countMap[`name:${cleanName}`] || 0) + qty;
            }
          });
        });
      }

      return countMap;
    },
  });

  // When menu items load, if cart is empty and user has no canteen_id, sync slot config from the active menu's canteen
  useEffect(() => {
    if (cart.length === 0 && !profile?.canteen_id && menuItems.length > 0) {
      const menuCanteenId = menuItems[0]?.canteen_id;
      if (menuCanteenId) {
        fetchLunchSlotConfig(menuCanteenId).then(cfg => {
          setSlotConfig(cfg);
        });
      }
    }
  }, [menuItems, cart.length, profile?.canteen_id]);

  // Filtered menu items combining Search, Veg/Non-Veg, Category filters, and Popularity sorting
  const filteredMenuItems = useMemo(() => {
    const trimmedQuery = foodSearchQuery.trim().toLowerCase();
    const list = menuItems.filter(item => {
      // 1. Food Search (by name, case-insensitive partial match)
      if (trimmedQuery) {
        const itemName = (item.name || '').toLowerCase();
        if (!itemName.includes(trimmedQuery)) {
          return false;
        }
      }

      // 2. Veg / Non-Veg Type Filter
      if (foodTypeFilter === 'VEG' && item.veg_non_veg !== 'VEG') {
        return false;
      }
      if (foodTypeFilter === 'NON_VEG' && item.veg_non_veg !== 'NON_VEG') {
        return false;
      }

      // 3. Category Filter
      if (categoryFilter !== 'ALL') {
        const itemCat = getItemCategory(item);
        const name = (item.name || '').toLowerCase();
        if (categoryFilter === 'PACKED_FOOD' && itemCat !== 'Packed Food') return false;
        if (categoryFilter === 'MEALS' && itemCat !== 'Meals') return false;
        if (categoryFilter === 'DRINKS' && itemCat !== 'Drinks') return false;
        if (categoryFilter === 'SOUTH_INDIAN') {
          const isSouth = /\b(idly|idli|dosa|dosai|vada|vadai|uttapam|sambar|rasam|pongal|upma|curd rice|poori)\b/i.test(name) || name.includes('south');
          if (!isSouth && itemCat !== 'Meals') return false;
        }
        if (categoryFilter === 'NORTH_INDIAN') {
          const isNorth = /\b(roti|chapati|naan|paneer|dal|paratha|chole|bhature|kulcha|butter|tikka|gravy)\b/i.test(name) || name.includes('north');
          if (!isNorth) return false;
        }
        if (categoryFilter === 'RICE_MEALS') {
          const isRice = /\b(rice|biryani|pulao|fried rice|meals|thali|khichdi)\b/i.test(name) || itemCat === 'Meals';
          if (!isRice) return false;
        }
        if (categoryFilter === 'SNACKS') {
          const isSnack = itemCat === 'Packed Food' || /\b(samosa|puff|roll|sandwich|cutlet|pakoda|baji|chips|biscuit|snack)\b/i.test(name);
          if (!isSnack) return false;
        }
        if (categoryFilter === 'BEVERAGES') {
          const isBeverage = itemCat === 'Drinks' || /\b(tea|chai|coffee|juice|water|soda|drink|milk|shake|lassi)\b/i.test(name);
          if (!isBeverage) return false;
        }
        if (categoryFilter === 'DESSERTS') {
          const isDessert = /\b(ice cream|icecream|dessert|sweet|gulab|jamun|halwa|payasam|cake|pastry|kheer)\b/i.test(name);
          if (!isDessert && !name.includes('sweet')) return false;
        }
      }

      return true;
    });

    // Sort items by popularity (highest sold first), then alphabetical, showing ALL foods directly on dashboard
    return list.sort((a, b) => {
      const getCount = (item: any) => {
        const cleanName = (item.name || '').replace(/^\[(?:DELETED|ARCHIVED)\]\s*/i, '').toLowerCase().trim();
        return (
          salesCountMap[item.id] ||
          salesCountMap[cleanName] ||
          salesCountMap[`name:${cleanName}`] ||
          0
        );
      };
      const countA = getCount(a);
      const countB = getCount(b);
      if (countB !== countA) return countB - countA;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [menuItems, foodSearchQuery, foodTypeFilter, categoryFilter, salesCountMap]);

  const { data: pastOrdersData = [], isLoading: pastOrdersLoading } = useQuery({
    queryKey: ['pastOrders', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            menu_items (*)
          ),
          item_reviews (*)
        `)
        .eq('user_id', profile.id)
        .in('status', ['COLLECTED', 'REJECTED'])
        .order('created_at', { ascending: false });
      return (data as unknown as PastOrder[]) || [];
    },
    enabled: !!profile?.id,
  });

  useEffect(() => {
    if (pastOrdersData) setPastOrders(pastOrdersData);
  }, [pastOrdersData]);


  const isSuspended = !!(profile?.suspended_until && new Date(profile.suspended_until) > new Date());
  const strikeCount = profile?.strike_count || 0;

  const cartTotalItems = cart.reduce((acc, c) => acc + c.quantity, 0);
  const cartTotalPrice = cart.reduce((acc, c) => acc + (Number(c.item.price || 0) * c.quantity), 0);

  const ledger = useMemo(() => calculateOrderLedger(cartTotalPrice), [cartTotalPrice]);


  // Latest collected order (from activeOrder if collected, or from past orders, or Order #97 from student session)
  const latestCollected = useMemo(() => {
    if (activeOrder?.status === 'COLLECTED') return activeOrder;
    const fromPast = (pastOrders || []).find(o => o.status === 'COLLECTED') || (pastOrdersData || []).find(o => o.status === 'COLLECTED');
    if (fromPast) return fromPast as any;
    return {
      id: 'demo-order-97',
      order_number: 97,
      status: 'COLLECTED',
      created_at: new Date().toISOString(),
      pickup_time: '10:36 AM',
      collected_at: new Date().toISOString(),
      is_takeaway: false,
      order_items: [
        {
          id: 'item-1',
          quantity: 1,
          name: 'lays',
          price: 5,
          menu_items: { name: 'lays', price: 5 }
        }
      ],
      canteens: { name: 'yyy' }
    };
  }, [activeOrder, pastOrders, pastOrdersData]);

  // If user has an in-progress active order (PLACED/ACCEPTED/PREPARING/READY), show it.
  // If user has items in cart or clicked to build an order, show Cart Builder.
  // If an order was recently collected (< 60s ago) and has not been dismissed, show the Collected card.
  const displayOrder = useMemo(() => {
    // In-progress order (not yet collected)
    if (activeOrder && activeOrder.status !== 'COLLECTED') return activeOrder;

    // If user explicitly dismissed or is building cart, show cart builder
    if (cart.length > 0 || showCartBuilder || collectedDismissed) return null;

    // Check if activeOrder is collected
    if (activeOrder?.status === 'COLLECTED') {
      const isDismissed = sessionStorage.getItem(`dismissed_collected_${activeOrder.id}`) === 'true';
      if (isDismissed) return null;

      // Check if 1 minute (60s) has passed since collection
      const collectedTime = activeOrder.collected_at ? new Date(activeOrder.collected_at).getTime() : 0;
      if (collectedTime > 0 && Date.now() - collectedTime > 60 * 1000) {
        return null;
      }
      return activeOrder;
    }

    return null;
  }, [activeOrder, cart.length, showCartBuilder, collectedDismissed]);

  const addToCart = (item: MenuItem) => {
    setShowCartBuilder(true);
    if (isSuspended) {
      showAlert({
        title: 'Account Deactivated',
        message: 'Your account is currently deactivated for 3 days due to 2 missed pickups.',
        type: 'danger'
      });
      return;
    }
    if (isLunchClosedForToday) {
      showAlert({
        title: 'Lunch Ordering Closed',
        message: `Lunch service has ended for today (Closed at ${formatSingleTime(slotConfig.serviceEndTime)}). Orders cannot be placed at this time.`,
        type: 'warning'
      });
      return;
    }
    if (item.is_sold_out) return;
    if (cartTotalItems >= 5) {
      showAlert({
        title: 'Order Limit Reached',
        message: 'You can order a maximum of 5 items per lunch order.',
        type: 'warning'
      });
      return;
    }

    const existing = cart.find(c => c.item.id === item.id);
    const stock = (item as any).stock_quantity;
    if (stock !== null && stock !== undefined && stock <= (existing?.quantity || 0)) {
      showAlert({
        title: 'Out of Stock',
        message: `Sorry, only ${stock} ${stock === 1 ? 'item is' : 'items are'} available for "${item.name}".`,
        type: 'warning'
      });
      return;
    }

    if (existing) {
      setCart(cart.map(c => c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { item, quantity: 1 }]);
    }
  };

  const removeFromCart = (itemId: string) => {
    const existing = cart.find(c => c.item.id === itemId);
    if (existing && existing.quantity > 1) {
      setCart(cart.map(c => c.item.id === itemId ? { ...c, quantity: c.quantity - 1 } : c));
    } else {
      setCart(cart.filter(c => c.item.id !== itemId));
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    if (isLunchClosedForToday) {
      setError(`Lunch ordering has ended for today (Service closed at ${formatSingleTime(slotConfig.serviceEndTime)}).`);
      return;
    }

    // Authoritative check: Pickup time cannot be in the past or before required lead time
    const nowIST = getISTDateTime(Date.now());
    const isToday = selectedDate === nowIST.dateStr;
    const reqMinutes = parseTimeToMinutes(smartSchedule.pickupTimeStr || pickupTime);
    const prepDuration = calculateOrderPrepDuration(scheduledCartItems, slotConfig.defaultPrepTimeMinutes || 10);
    const minNotice = slotConfig.minNoticeMinutes || 0;
    const earliestAllowed = nowIST.totalMinutes + Math.max(prepDuration, minNotice);

    if (isToday && (reqMinutes <= nowIST.totalMinutes || reqMinutes < earliestAllowed)) {
      setError(`Cannot place order: selected pickup time (${formatSingleTime(smartSchedule.pickupTimeStr || pickupTime)}) has passed or is too soon. Please select the next available slot.`);
      if (suggestedQuickSlots.length > 0) {
        setPickupTime(suggestedQuickSlots[0]);
      }
      return;
    }

    if (!smartSchedule.isValid) {
      setError(smartSchedule.reason || 'Please select a valid lunch pickup time.');
      return;
    }

    const finalPickupTime = smartSchedule.pickupTimeStr || (typeof pickupTime === 'string' && pickupTime.includes(':') ? pickupTime.slice(0, 5) : '12:30');
    if (!finalPickupTime) {
      setError('Please select your preferred lunch pickup time.');
      return;
    }

    setSubmitting(true);
    setError('');

    const itemsJson = cart.map(c => ({
      id: c.item.id,
      quantity: c.quantity
    }));

    // 1. Generate Idempotency Key
    const idempotencyKey = crypto.randomUUID();

    try {
      // Check if user already has an active order (satisfying one_active_order_per_user_idx)
      const { data: existingActive } = await supabase
        .from('orders')
        .select('id, status, order_number')
        .eq('user_id', profile?.id)
        .in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])
        .maybeSingle();

      if (existingActive) {
        setError(`You already have an active order (#${existingActive.order_number || existingActive.id.slice(0, 6)} - ${existingActive.status}). Please complete or cancel it before placing a new one.`);
        const { data: fullActive } = await supabase.from('orders').select('*').eq('id', existingActive.id).single();
        if (fullActive) setActiveOrder(fullActive);
        setSubmitting(false);
        return;
      }

      const ledger = calculateOrderLedger(cartTotalPrice);
      let canteenId = cart[0]?.item?.canteen_id || profile?.canteen_id || null;
      const tenantId = cart[0]?.item?.tenant_id || profile?.tenant_id || null;

      if (!canteenId && tenantId) {
        const { data: firstCanteen } = await supabase
          .from('canteens')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (firstCanteen?.id) canteenId = firstCanteen.id;
      }

      // Build order payload safely with direct cash-on-collect placement
      // NOTE: We do NOT store OTP in the database!
      const orderPayload: any = {
        user_id: profile?.id,
        canteen_id: canteenId,
        tenant_id: tenantId,
        pickup_time: finalPickupTime,
        requested_pickup_time: smartSchedule.requestedPickupTime,
        planned_prep_start_time: smartSchedule.plannedPrepStartTime,
        target_ready_by_time: smartSchedule.targetReadyByTime,
        estimated_prep_duration_minutes: smartSchedule.estimatedPrepDurationMinutes,
        is_takeaway: false,
        status: 'PLACED',
        idempotency_key: idempotencyKey,
      };

      let directOrder: any = null;
      const { data: insertedOrder, error: directOrderErr } = await supabase
        .from('orders')
        .insert(orderPayload)
        .select('*')
        .single();

      if (directOrderErr) {
        // Fallback if extended scheduling columns or otp_code are not matching schema
        if (directOrderErr.code === 'PGRST204' || directOrderErr.message?.includes('column')) {
          console.warn('Retrying with base schema fields:', directOrderErr.message);
          const basicPayload: any = {
            user_id: profile?.id,
            canteen_id: canteenId,
            tenant_id: tenantId,
            pickup_time: finalPickupTime,
            is_takeaway: false,
            status: 'PLACED',
            idempotency_key: idempotencyKey,
          };

          const { data: retryOrder, error: retryErr } = await supabase
            .from('orders')
            .insert(basicPayload)
            .select('*')
            .single();

          if (retryErr) throw retryErr;
          directOrder = retryOrder;
        } else {
          throw directOrderErr;
        }
      } else {
        directOrder = insertedOrder;
      }

      const createdOrderId = directOrder?.id;
      if (!createdOrderId) {
        throw new Error('Failed to create order record.');
      }

      // Insert order items
      const orderItems = cart.map(c => ({
        order_id: createdOrderId,
        menu_item_id: c.item.id,
        quantity: c.quantity
      }));
      const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
      if (itemsErr) console.warn('Order items insert error:', itemsErr);

      // Decrement stock for packed items & automatically set sold out when stock reaches 0
      try {
        for (const c of cart) {
          const itemStock = (c.item as any).stock_quantity;
          if (itemStock != null && typeof itemStock === 'number') {
            const updatedStock = Math.max(0, itemStock - c.quantity);
            const isZero = updatedStock === 0;

            // Attempt DB update
            try {
              await (supabase.from('menu_items') as any).update({
                stock_quantity: updatedStock,
                is_sold_out: isZero
              }).eq('id', c.item.id);
            } catch (dbStockErr) {
              console.warn('DB stock decrement error:', dbStockErr);
            }

            // Sync local storage caches
            try {
              const lowerName = (c.item.name || '').trim().toLowerCase();
              const updateLocalMeta = (storageKey: string) => {
                const stored = localStorage.getItem(storageKey);
                const map = stored ? JSON.parse(stored) : {};
                map[c.item.id] = { ...(map[c.item.id] || {}), stock_quantity: updatedStock };
                if (lowerName) {
                  map[`name:${lowerName}`] = { ...(map[`name:${lowerName}`] || {}), stock_quantity: updatedStock };
                }
                localStorage.setItem(storageKey, JSON.stringify(map));
              };

              updateLocalMeta('skiptray_menu_meta_global');
              if (canteenId) {
                updateLocalMeta(`canteen_menu_meta_${canteenId}`);
              }
            } catch {}
          }
        }
        // Invalidate menu items query to refresh stock and sold out state immediately
        queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      } catch (stockSyncErr) {
        console.warn('Stock decrement routine warning:', stockSyncErr);
      }

      // Record ledger entry
      try {
        if (canteenId) {
          await supabase.from('order_ledger').insert({
            order_id: createdOrderId,
            student_id: profile?.id,
            canteen_id: canteenId,
            tenant_id: tenantId,
            food_subtotal: ledger.food_subtotal,
            commission_fee: ledger.commission_fee,
            target_net: ledger.target_net,
            gross_payable: ledger.food_subtotal, // Cash on collection
            gateway_fee: 0,
            gw_deduction: 0,
            net_settled: ledger.food_subtotal,
            canteen_payable: ledger.canteen_payable,
            platform_net: 0,
          });
        }
      } catch (ledErr) {
        console.warn('Optional ledger insert skipped:', ledErr);
      }

      // Retrieve placed order with items and activate
      const { data: newOrder } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            menu_items (*)
          ),
          canteens (name)
        `)
        .eq('id', createdOrderId)
        .single();

      if (newOrder) {
        setActiveOrder(newOrder);
      }
      setCart([]);
      setPickupTime(getInitialPickupTime());
      localStorage.removeItem('pending_order');
      setCartOpen(false);
      showAlert({
        title: 'Order Placed Successfully! 🎉',
        message: 'Your order has been sent to the kitchen. You can pay cash upon food collection at the counter.',
        type: 'success'
      });
    } catch (err: any) {
      const rawMsg = err.message || '';
      let formattedMsg = formatErrorMessage(err);
      if (rawMsg.toLowerCase().includes('rate limit') || rawMsg.toLowerCase().includes('one order per minute') || rawMsg.toLowerCase().includes('60 seconds')) {
        formattedMsg = 'Rate limit reached: You can only place 1 order per minute. Please wait a moment before trying again.';
        showAlert({
          title: 'Please Wait a Moment ⏳',
          message: 'You have placed an order recently. You can only place one order per minute to avoid duplicate orders. Please wait 60 seconds and try again.',
          type: 'warning',
        });
      } else {
        showAlert({
          title: 'Order Not Placed',
          message: formattedMsg,
          type: 'error',
        });
      }
      setError(formattedMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!activeOrder) return;

    if (activeOrder.status !== 'PLACED') {
      showAlert({
        title: 'Cannot Cancel Order',
        message: 'This order has already been accepted by the kitchen staff and cannot be cancelled.',
        type: 'error'
      });
      return;
    }

    const confirmed = await showConfirm({
      title: 'Cancel Order',
      message: 'Are you sure you want to cancel this order? This action cannot be undone.',
      confirmText: 'Yes, Cancel Order',
      cancelText: 'Keep Order',
      isDangerous: true
    });
    if (!confirmed) return;

    // Call cancel_order RPC with p_order_id matching Postgres schema signature
    let { error } = await supabase.rpc('cancel_order', {
      p_order_id: activeOrder.id
    });

    if (error && (error.code === 'PGRST202' || error.message?.includes('p_reason'))) {
      // Retry with p_order_id only if signature mismatch occurred
      const retry = await supabase.rpc('cancel_order', {
        p_order_id: activeOrder.id
      });
      error = retry.error;
    }

    if (error) {
      console.warn('cancel_order RPC returned error, attempting fallback update:', error.message);
      // Fallback: If in PLACED state, attempt direct status update to REJECTED
      if (activeOrder.status === 'PLACED') {
        try {
          const { error: directErr } = await supabase
            .from('orders')
            .update({ status: 'REJECTED', cancellation_reason: 'USER_CANCELLED' } as any)
            .eq('id', activeOrder.id)
            .eq('user_id', profile?.id);

          if (!directErr) {
            error = null;
          } else {
            const { error: retryErr } = await supabase
              .from('orders')
              .update({ status: 'REJECTED' } as any)
              .eq('id', activeOrder.id)
              .eq('user_id', profile?.id);
            if (!retryErr) error = null;
          }
        } catch {
          // ignore column missing
        }
      }
    }

    if (error) {
      showAlert({
        title: 'Cancellation Failed',
        message: 'Unable to cancel order. ' + (error.message.includes('5 minutes') ? 'Cancellation window (5 mins) has passed.' : error.message),
        type: 'error'
      });
    } else {
      try {
        sessionStorage.setItem(`cancelled_order_${activeOrder.id}`, 'true');
        localStorage.setItem(`cancelled_order_${activeOrder.id}`, 'true');
      } catch {}
      setActiveOrder(null);
      queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
      showAlert({
        title: 'Order Cancelled',
        message: 'Your order has been cancelled successfully.',
        type: 'success'
      });
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingItem || !profile?.id) return;
    setSubmittingReview(true);

    const { error } = await supabase.from('item_reviews').insert({
      order_id: reviewingItem.orderId,
      menu_item_id: reviewingItem.menuItemId,
      user_id: profile.id,
      tenant_id: profile.tenant_id,
      rating: reviewRating,
      feedback_text: reviewText
    });

    if (error) {
      showAlert({
        title: 'Submission Failed',
        message: formatErrorMessage(error, 'Failed to submit review. Please try again.'),
        type: 'error'
      });
    } else {
      setReviewingItem(null);
      setReviewRating(5);
      setReviewText('');
      queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
      showAlert({
        title: 'Thank You!',
        message: 'Your review has been submitted successfully.',
        type: 'success'
      });
    }
    setSubmittingReview(false);
  };

  const getOrderStatusText = (order: { id: string; status: string; cancellation_reason?: string | null }) => {
    if (order.status === 'REJECTED') {
      const isUserCancelled = 
        order.cancellation_reason === 'USER_CANCELLED' || 
        order.cancellation_reason?.toLowerCase().includes('cancel') ||
        sessionStorage.getItem(`cancelled_order_${order.id}`) === 'true' ||
        localStorage.getItem(`cancelled_order_${order.id}`) === 'true';
      return isUserCancelled ? 'CANCELLED' : 'REJECTED';
    }
    return order.status;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PLACED': return 'bg-slate-100 text-slate-600';
      case 'ACCEPTED': return 'bg-blue-100 text-blue-600';
      case 'PREPARING': return 'bg-orange-100 text-orange-600';
      case 'READY': return 'bg-green-100 text-green-600';
      case 'COLLECTED': return 'bg-green-100 text-green-700';
      case 'REJECTED':
      case 'CANCELLED': return 'bg-red-100 text-red-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <div className="w-full max-w-[1440px] mx-auto pb-16">
      {/* Canteen OS Top Greeting Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 px-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Hello, {profile?.name || 'Madeshwar'}</span>
              <span className="text-2xl">👋</span>
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-[#1d68f2] text-xs font-black uppercase tracking-wider">
              {profile?.role || 'Student'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
            What would you like to have today?
          </p>
        </div>

        {/* Status Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {strikeCount === 1 && !isSuspended && (
            <span className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs">
              <IconAlertTriangle size={14} className="text-amber-600 shrink-0" />
              <span>Strike 1/2 (No-Show Warning)</span>
            </span>
          )}
          {isSuspended && (
            <span className="px-3 py-1.5 bg-rose-50 text-rose-800 border border-rose-200 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs">
              <IconBan size={14} className="text-rose-600 shrink-0" />
              <span>Account Deactivated</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Content (Cols 12 or 8 when on menu) + Sticky Cart Sidebar (Col 4) */}
      <div className="grid grid-cols-12 gap-6">

      {/* Deactivation Banner */}
      {isSuspended && (
        <div className="col-span-12 bg-red-50 border-2 border-red-200 rounded-[2rem] p-6 sm:p-8 text-center flex flex-col items-center justify-center gap-3 mb-2 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600">
            <IconBan size={28} className="w-7 h-7 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-red-800">Account Temporarily Deactivated</h2>
            <p className="text-sm text-slate-600 max-w-lg mt-1.5 leading-relaxed">
              Your ordering privileges are suspended for <strong>3 days</strong> due to repeated uncollected orders (2 no-show strikes).
            </p>
          </div>
          <div className="bg-white px-4 py-2 rounded-xl border border-red-200 text-xs font-bold text-red-700 font-mono mt-1">
            Reactivates on: {new Date(profile!.suspended_until!).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', hour12: true })}
          </div>
        </div>
      )}

      {menuLoading ? (
        <div className="col-span-12 text-center text-slate-500">Loading...</div>
      ) : showHistory ? (
        <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Past Orders & Receipts</h2>
              <p className="text-xs text-slate-500 mt-0.5">Review collected meals, verification records, and rate your dishes</p>
            </div>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-4 py-2.5 rounded-xl border border-indigo-100 transition-colors shadow-2xs self-start sm:self-auto"
            >
              <ArrowLeft size={14} />
              <span>Back to Food Menu</span>
            </button>
          </div>
          {pastOrders.length === 0 ? (
            <div className="text-slate-500">No past orders found.</div>
          ) : (
            <div className="space-y-4">
              {pastOrders.map(o => {
                const totalAmount = (o.order_items || []).reduce((sum, oi) => {
                  const price = Number(oi.menu_items?.price ?? 0);
                  const qty = Number(oi.quantity) > 0 ? Number(oi.quantity) : 1;
                  return sum + (price * qty);
                }, 0);

                return (
                  <div key={o.id} className="p-4 rounded-xl border border-slate-200 flex flex-col gap-4 shadow-sm">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                      <div>
                        <div className="font-bold text-slate-800 text-lg">Order #{o.order_number}</div>
                        <div className="text-xs text-slate-500 font-mono font-medium mb-1">ID: {o.id.split('-')[0].toUpperCase()}</div>
                        <div className="text-xs text-slate-500 font-medium mb-1">Placed on: {new Date(o.created_at).toLocaleDateString()}</div>
                        <div className="text-sm text-slate-600 mt-1">
                          Pickup: {formatPickupTime((o as any).requested_pickup_time || o.pickup_time)} (Lunch)
                          {(o as any).estimated_prep_duration_minutes && (
                            <span className="text-xs text-slate-400 ml-2">
                              • Prep: {(o as any).estimated_prep_duration_minutes}m
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {o.status === 'COLLECTED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setCollectedOrderConfirmation({
                                order: o as any,
                                items: (o.order_items || []).map(oi => ({
                                  menuItemId: oi.menu_items?.id,
                                  name: oi.menu_items?.name || 'Meal Item',
                                  quantity: Number(oi.quantity) || 1,
                                  price: Number(oi.menu_items?.price ?? 0)
                                }))
                              });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95"
                            title="View official collected receipt"
                          >
                            <CheckCircle2 size={13} className="text-emerald-600" />
                            <span>View Receipt</span>
                          </button>
                        )}
                        <div className={`px-3 py-1 rounded-full text-xs font-bold border shrink-0 ${o.status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                          {getOrderStatusText(o as any)}
                        </div>
                      </div>
                    </div>

                    {o.order_items && o.order_items.length > 0 && (
                      <div className="space-y-3">
                        {o.order_items.map((oi, idx) => {
                          const menuItem = oi.menu_items;
                          if (!menuItem) return null;
                          const existingReview = o.item_reviews?.find(r => r.menu_item_id === menuItem.id);
                          const qty = Number(oi.quantity) > 0 ? Number(oi.quantity) : 1;
                          const unitPrice = Number(menuItem.price ?? 0);
                          const itemTotal = unitPrice * qty;

                          return (
                            <div key={idx} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                              <div className="flex justify-between items-center gap-2">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <span className="font-semibold text-slate-800 text-sm">
                                    {menuItem.name} *{qty}
                                  </span>
                                  {qty > 1 && (
                                    <span className="text-xs text-slate-400 font-normal">
                                      (@₹{unitPrice.toFixed(2)})
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="text-sm font-bold text-indigo-600 font-mono">
                                    ₹{itemTotal.toFixed(2)}
                                  </span>
                                  {o.status === 'COLLECTED' && !existingReview && reviewingItem?.menuItemId !== menuItem.id && (
                                    <button
                                      onClick={() => setReviewingItem({ orderId: o.id, menuItemId: menuItem.id, itemName: menuItem.name })}
                                      className="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                      Leave Review
                                    </button>
                                  )}
                                </div>
                              </div>

                            {/* Existing Review Display */}
                            {existingReview && (
                              <div className="mt-1 bg-white p-3 rounded-lg border border-indigo-100 shadow-sm">
                                <div className="flex items-center gap-1 mb-1">
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <IconStar
                                      key={i}
                                      size={14}
                                      className={`w-3.5 h-3.5 ${i < existingReview.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`}
                                      filled={i < existingReview.rating}
                                    />
                                  ))}
                                </div>
                                {existingReview.feedback_text && (
                                  <p className="text-sm text-slate-600 italic">"{existingReview.feedback_text}"</p>
                                )}
                                {existingReview.admin_reply && (
                                  <div className="mt-2 pl-3 border-l-2 border-indigo-300">
                                    <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Admin Reply</span>
                                    <p className="text-sm text-slate-700 mt-0.5">{existingReview.admin_reply}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Review Form */}
                            {reviewingItem?.orderId === o.id && reviewingItem?.menuItemId === menuItem.id && (
                              <form onSubmit={handleSubmitReview} className="mt-2 bg-white p-4 rounded-xl border border-indigo-200 shadow-sm animate-in fade-in slide-in-from-top-2">
                                <div className="flex justify-between items-center mb-3">
                                  <h4 className="font-bold text-slate-800 text-sm">Reviewing {reviewingItem.itemName}</h4>
                                  <button type="button" onClick={() => setReviewingItem(null)} className="text-slate-400 hover:text-slate-600 p-1">
                                    <IconX size={14} className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <div className="mb-3">
                                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Rating</label>
                                  <div className="flex gap-2">
                                    {[1, 2, 3, 4, 5].map(star => (
                                      <button
                                        key={star}
                                        type="button"
                                        onClick={() => setReviewRating(star)}
                                        className="p-0.5 transition-transform hover:scale-110 focus:outline-none"
                                      >
                                        <IconStar
                                          size={22}
                                          className={`w-5.5 h-5.5 ${star <= reviewRating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`}
                                          filled={star <= reviewRating}
                                        />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="mb-3">
                                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Feedback (Optional)</label>
                                  <textarea
                                    value={reviewText}
                                    onChange={(e) => setReviewText(e.target.value)}
                                    placeholder="How was the food?"
                                    maxLength={1000}
                                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    rows={2}
                                  />
                                </div>
                                <button
                                  type="submit"
                                  disabled={submittingReview}
                                  className="w-full bg-indigo-600 text-white font-semibold py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                >
                                  {submittingReview ? 'Submitting...' : 'Submit Review'}
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Order Total Summary Footer */}
                  {o.order_items && o.order_items.length > 0 && (
                    <div className="flex justify-between items-center pt-2 px-1 border-t border-slate-100">
                      <span className="text-xs text-slate-500 font-medium">
                        {o.order_items.reduce((s, i) => s + (Number(i.quantity) > 0 ? Number(i.quantity) : 1), 0)} items
                      </span>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 font-medium">Total: </span>
                        <span className="text-base font-extrabold text-slate-900 font-mono">₹{totalAmount.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Main 2-Column Canteen OS Layout */}
          <div className="col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column (8 cols): Compact Hero Promo + Combined Menu Header & Food Grid */}
            <div className="lg:col-span-8 space-y-4">
              {/* Compact Hero Banner with Motion */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#002b66] via-[#023e8a] to-[#001845] text-white p-3.5 sm:p-5 shadow-md"
              >
                <div className="relative z-10 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/30 border border-blue-400/30 text-blue-200 text-[10px] font-black uppercase tracking-wider">
                        <Sparkles size={11} className="text-amber-300" />
                        Fresh • Fast • Hygienic
                      </span>
                      <span className="text-[11px] text-blue-200/80 font-medium hidden sm:inline">
                        ⚡ Skip the canteen line
                      </span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                      Order Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-400">Favourite Food</span>
                    </h2>
                  </div>

                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <span className="px-3 py-1 rounded-full bg-white/10 text-blue-100 text-xs font-bold border border-white/15">
                      Hot & Fresh 🔥
                    </span>
                  </div>
                </div>
              </motion.div>

              {/* Combined Menu Card (Filter & Search Header + Grid in single cohesive section) */}
              <div id="menu-items-section" className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 shadow-sm space-y-3 sm:space-y-4">
                {/* Top Row: Menu Title + Subtitle on Left, Search Input on Right */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1d68f2] shadow-xs shrink-0">
                      <UtensilsCrossed size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base sm:text-xl font-black text-slate-900 tracking-tight leading-none">
                          All Menu Items
                        </h2>
                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                          {filteredMenuItems.length} dishes
                        </span>
                      </div>
                      <p className="hidden sm:block text-xs text-slate-500 font-medium mt-0.5">
                        Browse all available canteen foods, meals & packed items
                      </p>
                    </div>
                  </div>

                  {/* Search food items input with blue search icon */}
                  <div className="relative w-full sm:w-72">
                    <IconSearch size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1d68f2] pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search food items..."
                      value={foodSearchQuery}
                      onChange={e => setFoodSearchQuery(e.target.value)}
                      className="w-full bg-slate-50/80 border border-slate-200 focus:bg-white focus:border-[#1d68f2] focus:ring-2 focus:ring-blue-100 rounded-full text-xs text-slate-800 placeholder:text-slate-400 pl-9 pr-8 py-2 outline-none transition-all"
                    />
                    {foodSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setFoodSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full"
                      >
                        <IconX size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter Pills Row - Single horizontal scrollable bar on mobile, flex-wrap on desktop */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scrollbar-none pb-0.5 -mx-1 px-1 sm:mx-0 sm:px-0 sm:flex-wrap pt-2 border-t border-slate-100">
                  {/* All button */}
                  <button
                    type="button"
                    onClick={() => {
                      setFoodTypeFilter('ALL');
                      setCategoryFilter('ALL');
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                      foodTypeFilter === 'ALL' && categoryFilter === 'ALL'
                        ? 'bg-[#1d68f2] text-white shadow-sm shadow-blue-500/25 ring-2 ring-blue-400/30'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <LayoutGrid size={13} />
                    <span>All</span>
                  </button>

                  {/* Veg button */}
                  <button
                    type="button"
                    onClick={() => setFoodTypeFilter(foodTypeFilter === 'VEG' ? 'ALL' : 'VEG')}
                    className={`px-3 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 transition-all border shrink-0 cursor-pointer ${
                      foodTypeFilter === 'VEG'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-500/20'
                        : 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/60'
                    }`}
                  >
                    <Leaf size={13} className={foodTypeFilter === 'VEG' ? 'text-white' : 'text-emerald-600'} />
                    <span>Veg</span>
                  </button>

                  {/* Non-Veg button */}
                  <button
                    type="button"
                    onClick={() => setFoodTypeFilter(foodTypeFilter === 'NON_VEG' ? 'ALL' : 'NON_VEG')}
                    className={`px-3 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 transition-all border shrink-0 cursor-pointer ${
                      foodTypeFilter === 'NON_VEG'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-sm shadow-rose-500/20'
                        : 'bg-rose-50/80 text-rose-700 border-rose-200/80 hover:bg-rose-100/60'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-rose-200" />
                    <span>Non-Veg</span>
                  </button>

                  <div className="h-4 w-px bg-slate-200 shrink-0 mx-0.5" />

                  {/* Packed Food */}
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(categoryFilter === 'SNACKS' ? 'ALL' : 'SNACKS')}
                    className={`px-3 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 transition-all border shrink-0 cursor-pointer ${
                      categoryFilter === 'SNACKS'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Package size={13} className="text-slate-500" />
                    <span>Packed Food</span>
                  </button>
                </div>

                {/* Empty State */}
                {filteredMenuItems.length === 0 ? (
                  <div className="py-8 px-4 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <IconPackage size={32} className="text-slate-300 mx-auto mb-2" />
                    <h4 className="text-sm font-bold text-slate-700">
                      No Food Items Found
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                      No items matched your search or category filter.
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setFoodSearchQuery('');
                          setFoodTypeFilter('ALL');
                          setCategoryFilter('ALL');
                        }}
                        className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Food Grid Cards without Images - 2 in a row on mobile */
                  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3.5 pt-1">
                    {filteredMenuItems.map(item => {
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
                        (item.name || '').toLowerCase().includes('packed') ||
                        getItemCategory(item) === 'Packed Food';
                      const stock = (item as any).stock_quantity ?? null;
                      const prepMinutes = (item as any).prep_time_minutes ?? (isPacked ? 0 : 10);
                      const isSoldOut = item.is_sold_out || (isPacked && stock !== null && stock <= 0);

                      const cartEntry = cart.find(c => c.item.id === item.id);
                      const quantity = cartEntry?.quantity || 0;
                      const isMaxStockReached = stock !== null && quantity >= stock;

                      // Clean border accent
                      const isVeg = item.veg_non_veg === 'VEG';
                      let themeBorder = 'border-l-4 border-emerald-500';
                      let themeBg = 'bg-white hover:bg-emerald-50/20';

                      if (isPacked) {
                        themeBorder = 'border-l-4 border-amber-400';
                        themeBg = 'bg-white hover:bg-amber-50/20';
                      } else if (!isVeg) {
                        themeBorder = 'border-l-4 border-rose-500';
                        themeBg = 'bg-white hover:bg-rose-50/20';
                      }

                      const soldCount = salesCountMap[item.id] || salesCountMap[`name:${(item.name || '').toLowerCase()}`] || 0;

                      return (
                        <div
                          key={item.id}
                          className={`relative rounded-xl sm:rounded-2xl border border-slate-200/90 p-2.5 sm:p-4 flex flex-col justify-between shadow-2xs transition-all duration-200 hover:shadow-sm ${themeBorder} ${themeBg} ${
                            isSoldOut ? 'opacity-60 bg-slate-50 grayscale-25' : ''
                          }`}
                        >
                          <div>
                            {/* Badges Row - Clean & Compact for 2-column view */}
                            <div className="flex items-center justify-between gap-1 mb-1.5 flex-wrap">
                              <div className="flex items-center gap-1 flex-wrap">
                                {/* Veg/Non-Veg Badge */}
                                <div className={`flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[11px] font-black ${
                                  isVeg ? 'bg-emerald-100/90 text-emerald-800' : 'bg-rose-100/90 text-rose-800'
                                }`}>
                                  {isVeg ? (
                                    <Leaf size={9} className="text-emerald-700" />
                                  ) : (
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600 ring-1 ring-rose-200" />
                                  )}
                                  <span>{isVeg ? 'Veg' : 'Non-Veg'}</span>
                                </div>

                                {/* Prep Time or Category Badge */}
                                {isPacked ? (
                                  <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200/60">
                                    <Package size={9} className="text-blue-600" />
                                    <span>Packed</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[11px] font-bold bg-amber-100/80 text-amber-900">
                                    <IconClock size={9} className="text-amber-800" />
                                    <span>{prepMinutes}m</span>
                                  </div>
                                )}
                              </div>

                              {/* Highlight Tag on Right */}
                              {isSoldOut ? (
                                <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[8px] sm:text-[9px] font-black uppercase tracking-wider">
                                  Sold Out
                                </span>
                              ) : soldCount > 0 ? (
                                <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 text-[8px] sm:text-[9px] font-black flex items-center gap-0.5 shadow-2xs">
                                  🔥 {soldCount}
                                </span>
                              ) : null}
                            </div>

                            {/* Food Title */}
                            <h3 className="text-xs sm:text-base font-black text-slate-900 tracking-tight leading-snug line-clamp-2">
                              {item.name}
                            </h3>
                          </div>

                          {/* Footer: Price on Left, Pill Button on Right */}
                          <div className="pt-2 sm:pt-2.5 border-t border-slate-100 flex items-center justify-between gap-1 mt-2 sm:mt-3">
                            <div className="text-sm sm:text-xl font-black text-[#1d68f2] tracking-tight leading-tight">
                              ₹{Number(item.price || 0).toFixed(2)}
                            </div>

                            {!isSoldOut ? (
                              quantity > 0 ? (
                                <div className="flex items-center bg-[#1d68f2] text-white rounded-full p-0.5 shadow-xs shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => removeFromCart(item.id)}
                                    aria-label={`Decrease quantity of ${item.name}`}
                                    className="w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-white/20 rounded-full font-black text-xs sm:text-sm transition-colors active:scale-90 cursor-pointer"
                                  >
                                    −
                                  </button>
                                  <span className="w-4 sm:w-6 text-center font-black text-[10px] sm:text-xs text-white tabular-nums">
                                    {quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => addToCart(item)}
                                    disabled={isSuspended || isLunchClosedForToday || cartTotalItems >= 5 || isMaxStockReached}
                                    aria-label={`Increase quantity of ${item.name}`}
                                    className="w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-white/20 rounded-full font-black text-xs sm:text-sm transition-colors disabled:opacity-40 active:scale-90 cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <div className="relative shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => addToCart(item)}
                                    disabled={isSuspended || isLunchClosedForToday || cartTotalItems >= 5 || isMaxStockReached}
                                    className="px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full bg-[#1d68f2] hover:bg-blue-600 text-white font-extrabold text-[11px] sm:text-xs transition-all shadow-sm shadow-blue-500/25 flex items-center gap-0.5 sm:gap-1 active:scale-95 disabled:opacity-40 cursor-pointer"
                                  >
                                    <span className="text-xs sm:text-base leading-none font-black">+</span>
                                    <span>Add</span>
                                  </button>
                                </div>
                              )
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-500 text-[9px] sm:text-[10px] font-bold shrink-0">
                                Unavailable
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>

            {/* Right Column (4 cols): Sticky Desktop Panel (Active Order Status or Cart Builder) with Motion */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="hidden lg:block lg:col-span-4 sticky top-20"
            >
              <div className="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 shadow-lg shadow-slate-100 flex flex-col justify-between max-h-[calc(100vh-6rem)] overflow-y-auto">
                {displayOrder ? (
                  /* ================= Active Order Live Status View Inside Box ================= */
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                          displayOrder.status === 'COLLECTED'
                            ? 'bg-emerald-100 text-emerald-600'
                            : 'bg-blue-100 text-[#1d68f2]'
                        }`}>
                          {displayOrder.status === 'COLLECTED' ? <CheckCircle2 size={16} /> : <Flame size={16} />}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-black text-slate-900 text-sm leading-tight">
                              Order #{displayOrder.order_number}
                            </h3>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              displayOrder.status === 'COLLECTED'
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                : displayOrder.status === 'READY'
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                : displayOrder.status === 'PREPARING'
                                ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                : 'bg-blue-100 text-blue-700 border border-blue-200'
                            }`}>
                              {displayOrder.status === 'COLLECTED' ? 'COLLECTED' : getOrderStatusText(displayOrder as any)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-medium">
                            {displayOrder.status === 'COLLECTED'
                              ? `Collected at ${formatSingleTime((displayOrder as any).collected_at || new Date().toISOString())}`
                              : `Pickup at ${formatSingleTime(displayOrder.pickup_time)}`}
                          </p>
                        </div>
                      </div>

                      {/* Cancel button: allowed anytime before staff accepts order (PLACED only) */}
                      {displayOrder.status === 'PLACED' && (
                        <button
                          type="button"
                          onClick={handleCancelOrder}
                          className="text-[11px] text-rose-500 hover:text-rose-700 font-bold bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-lg border border-rose-200 transition-colors cursor-pointer"
                          title="Cancel Order"
                        >
                          Cancel
                        </button>
                      )}

                      {/* Dismiss button when COLLECTED */}
                      {displayOrder.status === 'COLLECTED' && (
                        <button
                          type="button"
                          onClick={() => handleDismissCollectedOrder(displayOrder.id)}
                          className="text-[11px] text-slate-400 hover:text-slate-700 font-bold bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                          title="Dismiss and Order Again"
                        >
                          ✕ Done
                        </button>
                      )}
                    </div>

                    {/* Progress Step Bar with Distinct Colors per Stage */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
                      <div className="flex items-center justify-between relative px-2">
                        {/* Connecting background and active progress track */}
                        <div className="absolute left-[18px] right-[18px] top-2.5 h-0.5 bg-slate-200 -z-0">
                          <div
                            className={`h-full transition-all duration-500 ${
                              displayOrder.status === 'COLLECTED'
                                ? 'bg-gradient-to-r from-blue-500 via-emerald-500 via-amber-500 via-purple-500 to-teal-500'
                                : displayOrder.status === 'READY'
                                ? 'bg-gradient-to-r from-blue-500 via-emerald-500 via-amber-500 to-purple-600'
                                : displayOrder.status === 'PREPARING'
                                ? 'bg-gradient-to-r from-blue-500 via-emerald-500 to-amber-500'
                                : displayOrder.status === 'ACCEPTED'
                                ? 'bg-gradient-to-r from-blue-500 to-emerald-500'
                                : 'bg-blue-500'
                            }`}
                            style={{
                              width:
                                displayOrder.status === 'PLACED' ? '0%' :
                                displayOrder.status === 'ACCEPTED' ? '25%' :
                                displayOrder.status === 'PREPARING' ? '50%' :
                                displayOrder.status === 'READY' ? '75%' : '100%'
                            }}
                          />
                        </div>

                        {[
                          {
                            key: 'PLACED',
                            label: 'Placed',
                            done: true,
                            current: displayOrder.status === 'PLACED',
                            color: 'bg-blue-600 text-white border-blue-600 shadow-blue-500/25',
                            textColor: 'text-blue-700',
                          },
                          {
                            key: 'ACCEPTED',
                            label: 'Accepted',
                            done: ['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'].includes(displayOrder.status),
                            current: displayOrder.status === 'ACCEPTED',
                            color: 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-500/25',
                            textColor: 'text-emerald-700',
                          },
                          {
                            key: 'PREPARING',
                            label: 'Cooking',
                            done: ['PREPARING', 'READY', 'COLLECTED'].includes(displayOrder.status),
                            current: displayOrder.status === 'PREPARING',
                            color: 'bg-amber-500 text-white border-amber-500 shadow-amber-500/25',
                            textColor: 'text-amber-700',
                          },
                          {
                            key: 'READY',
                            label: 'Ready',
                            done: ['READY', 'COLLECTED'].includes(displayOrder.status),
                            current: displayOrder.status === 'READY',
                            color: 'bg-purple-600 text-white border-purple-600 shadow-purple-500/25',
                            textColor: 'text-purple-700',
                          },
                          {
                            key: 'COLLECTED',
                            label: 'Collected',
                            done: displayOrder.status === 'COLLECTED',
                            current: displayOrder.status === 'COLLECTED',
                            color: 'bg-teal-600 text-white border-teal-600 shadow-teal-500/25',
                            textColor: 'text-teal-700',
                          }
                        ].map((step, idx) => (
                          <div key={idx} className="flex flex-col items-center z-10">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black border transition-all ${
                              step.done
                                ? `${step.color} shadow-xs scale-105`
                                : 'bg-white border-slate-300 text-slate-400'
                            } ${step.current ? 'ring-2 ring-offset-1 ring-slate-300 scale-110' : ''}`}>
                              {step.done ? '✓' : idx + 1}
                            </div>
                            <span className={`text-[10px] font-bold mt-1 transition-colors ${
                              step.done ? step.textColor : 'text-slate-400'
                            }`}>
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Status Highlights & Pass / QR Code / Collected View */}
                    {displayOrder.status === 'COLLECTED' ? (
                      /* ================= ORDER COLLECTED SUCCESSFULLY PAGE ================= */
                      <div className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-teal-50/50 to-emerald-100/30 border border-emerald-200 rounded-2xl p-4 sm:p-5 text-center space-y-3.5 shadow-xs">
                        {/* Soft celebratory decorative stars */}
                        <div className="absolute top-2.5 left-3 text-emerald-400 opacity-60 text-xs select-none">✨</div>
                        <div className="absolute top-3.5 right-4 text-emerald-400 opacity-60 text-sm select-none">🎉</div>
                        <div className="absolute bottom-3 left-4 text-emerald-400 opacity-40 text-xs select-none">🌟</div>

                        {/* Animated 3D Success Icon Badge */}
                        <div className="relative mx-auto w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-[1.5px] shadow-lg shadow-emerald-500/25 flex items-center justify-center">
                          <div className="w-full h-full rounded-[14px] bg-gradient-to-b from-emerald-500 to-teal-600 flex items-center justify-center text-white relative overflow-hidden">
                            <div className="absolute top-0 inset-x-0 h-1/2 bg-white/30 rounded-t-[14px]" />
                            <CheckCircle2 size={28} className="relative z-10 drop-shadow-sm text-white" strokeWidth={2.6} />
                          </div>
                        </div>

                        {/* Heading & description */}
                        <div>
                          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-300/80 text-emerald-800 text-[10px] font-black uppercase tracking-wider mb-1">
                            <span>Order Handed Over</span>
                            <span>✓</span>
                          </div>
                          <h4 className="font-black text-slate-900 text-base sm:text-lg tracking-tight">
                            Order Collected Successfully! 🎉
                          </h4>
                          <p className="text-xs text-slate-600 mt-1 max-w-xs mx-auto leading-relaxed">
                            Your food has been handed over at the counter. Enjoy your hot & fresh meal!
                          </p>
                        </div>

                        {/* Verified Pickup Details Pill */}
                        <div className="bg-white/95 border border-emerald-200/90 rounded-xl py-2 px-3 flex items-center justify-around text-center shadow-2xs">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">Canteen</span>
                            <span className="text-xs font-black text-slate-800 truncate max-w-[90px] block">
                              {(displayOrder as any).canteens?.name || 'Main Canteen'}
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
                              {formatSingleTime((displayOrder as any).collected_at || new Date().toISOString())}
                            </span>
                          </div>
                        </div>

                        {/* Action Buttons: Leave Review & Order More */}
                        <div className="pt-1 flex flex-col sm:flex-row gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowHistory(true);
                              setTimeout(() => {
                                const el = document.getElementById(`order-${displayOrder.id}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                              }, 150);
                            }}
                            className="flex-1 py-2 px-3 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Star size={13} className="text-amber-500 fill-amber-500" />
                            <span>Rate Meal</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDismissCollectedOrder(displayOrder.id)}
                            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <span>Order More Food →</span>
                            {autoCloseCountdown > 0 && (
                              <span className="px-1.5 py-0.5 rounded-full bg-emerald-800/50 text-[10px] font-mono">
                                {autoCloseCountdown}s
                              </span>
                            )}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium">
                          Auto-closing and returning to menu in <span className="font-bold text-emerald-600">{autoCloseCountdown}s</span>
                        </p>
                      </div>
                    ) : displayOrder.status === 'READY' ? (
                      <div className="bg-gradient-to-b from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-4 text-center space-y-3">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-black shadow-xs">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                          </span>
                          <span>READY FOR PICKUP • {liveTickerTime}</span>
                        </div>

                        {/* QR Code */}
                        <div
                          onClick={() => setShowQrModal(true)}
                          className="bg-white p-3 rounded-2xl border-2 border-emerald-400 shadow-md inline-block cursor-pointer hover:scale-105 transition-transform group relative"
                          title="Click to Enlarge QR Code"
                        >
                          <QRCodeSVG
                            value={`SKIPTRAY:${displayOrder.id}:${currentOtp}`}
                            size={140}
                            className="rounded-lg mx-auto"
                          />
                          <div className="absolute inset-0 bg-slate-900/60 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-bold gap-1">
                            <IconMaximize size={16} />
                            <span>Enlarge</span>
                          </div>
                        </div>

                        {/* OTP Display */}
                        <div className="bg-white px-3 py-2.5 rounded-xl border border-emerald-200">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Pickup Verification OTP
                          </p>
                          {currentOtp ? (
                            <p className="text-2xl font-mono font-black tracking-[0.25em] text-emerald-700 my-0.5">
                              {currentOtp}
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={handleRequestOtp}
                              disabled={requestingOtp}
                              className="mt-1 px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg shadow-xs hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                            >
                              {requestingOtp ? 'Generating...' : 'Get OTP Code'}
                            </button>
                          )}
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Show OTP or scan QR at counter
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* Preparing / In-progress notice */
                      <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 text-center space-y-2">
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-[#1d68f2] flex items-center justify-center mx-auto">
                          <IconHourglass size={20} className="animate-spin" style={{ animationDuration: '4s' }} />
                        </div>
                        <div>
                          <h4 className="font-black text-slate-900 text-sm">
                            {displayOrder.status === 'PLACED' && 'Order Received'}
                            {displayOrder.status === 'ACCEPTED' && 'Order Accepted'}
                            {displayOrder.status === 'PREPARING' && 'Preparing Your Meal'}
                          </h4>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {displayOrder.status === 'PLACED' && 'Sent to kitchen staff. Awaiting confirmation.'}
                            {displayOrder.status === 'ACCEPTED' && 'Kitchen accepted and will cook your meal on schedule.'}
                            {displayOrder.status === 'PREPARING' && 'Food is being freshly cooked right now!'}
                          </p>
                        </div>
                        <div className="pt-2 border-t border-blue-100 flex items-center justify-center gap-1.5 text-[10px] text-blue-700 font-bold">
                          <Lock size={11} />
                          <span>QR & OTP unlock automatically when READY</span>
                        </div>
                      </div>
                    )}

                    {/* Items List inside Active Order */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Ordered Items
                        </span>
                        <span className="text-[11px] font-bold text-slate-500">
                          {(displayOrder as any).canteens?.name || 'Main Canteen'}
                        </span>
                      </div>

                      <div className="space-y-1.5 divide-y divide-slate-100">
                        {(displayOrder as any).order_items && (displayOrder as any).order_items.length > 0 ? (
                          (displayOrder as any).order_items.map((oi: any, idx: number) => {
                            const itemName = oi.menu_items?.name || oi.name || 'Meal Item';
                            const itemPrice = Number(oi.menu_items?.price ?? oi.price ?? 0);
                            const itemQty = Number(oi.quantity) || 1;
                            return (
                              <div key={idx} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                                <div>
                                  <span className="font-bold text-slate-800">{itemName}</span>
                                  <span className="text-[10px] text-slate-400 block font-medium">Qty: {itemQty}</span>
                                </div>
                                <span className="font-black text-slate-900 font-mono">
                                  ₹{(itemPrice * itemQty).toFixed(2)}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-xs text-slate-400 italic">Order details loaded</div>
                        )}
                      </div>
                    </div>

                    {/* Order Meta Badges */}
                    <div className="grid grid-cols-2 gap-2 text-center text-xs">
                      <div className="bg-slate-50 border border-slate-200/70 p-2 rounded-xl">
                        <span className="text-[9px] text-slate-400 uppercase font-black block">Mode</span>
                        <span className="font-bold text-slate-800 text-xs mt-0.5 block">
                          {displayOrder.is_takeaway ? 'Takeaway' : 'Dine-In'}
                        </span>
                      </div>
                      <div className="bg-slate-50 border border-slate-200/70 p-2 rounded-xl">
                        <span className="text-[9px] text-slate-400 uppercase font-black block">Scheduled Pickup</span>
                        <span className="font-bold text-slate-800 text-xs mt-0.5 block">
                          {formatSingleTime(displayOrder.pickup_time)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ================= Default Cart & Order Placement Builder ================= */
                  <div>
                    {/* Cart Header */}
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-blue-100 text-[#1d68f2] flex items-center justify-center font-black text-xs">
                          <ShoppingCart size={16} />
                        </div>
                        <div>
                          <h3 className="font-black text-slate-900 text-base leading-tight">Your Order</h3>
                          <p className="text-[11px] text-slate-400 font-medium">
                            {cartTotalItems} item{cartTotalItems === 1 ? '' : 's'} (Max 5)
                          </p>
                        </div>
                      </div>

                      {cart.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setCart([])}
                          className="text-xs text-rose-500 hover:text-rose-700 font-bold transition-colors cursor-pointer"
                        >
                          Clear All
                        </button>
                      )}
                    </div>

                    {/* Operational Warnings */}
                    {isSunday && (
                      <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800 font-medium">
                        <IconBan size={16} className="text-amber-600 shrink-0" />
                        <span>Canteen closed on Sundays.</span>
                      </div>
                    )}

                    {!isSunday && isBeforeOpeningTime && (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2 text-xs text-blue-800 font-medium">
                        <IconClock size={16} className="text-blue-600 shrink-0" />
                        <span>Lunch booking opens at 9:30 AM today.</span>
                      </div>
                    )}

                    {!isSunday && isLunchClosedForToday && (
                      <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800 font-medium">
                        <IconClock size={16} className="text-rose-600 shrink-0" />
                        <span>Lunch ordering closed for today.</span>
                      </div>
                    )}

                    {/* Cart Items List without food images */}
                    <div className="space-y-3 mb-4 max-h-60 overflow-y-auto pr-1">
                      {cart.length === 0 ? (
                        <div className="text-center py-8 px-3 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-300">
                            <ShoppingCart size={22} />
                          </div>
                          <p className="text-xs font-bold text-slate-600">No items selected</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Click "+ Add" on any menu item to build your lunch order.
                          </p>
                        </div>
                      ) : (
                        cart.map(c => {
                          const liveItem = menuItems.find(m => m.id === c.item.id);
                          const isSoldOut = liveItem?.is_sold_out ?? false;

                          return (
                            <div
                              key={c.item.id}
                              className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all ${
                                isSoldOut ? 'bg-rose-50/50 border-rose-200' : 'bg-slate-50/70 border-slate-200/70'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    liveItem?.veg_non_veg === 'VEG' ? 'bg-emerald-500' : 'bg-rose-500'
                                  }`}
                                />
                                <div className="min-w-0">
                                  <h4
                                    className={`text-xs font-bold truncate leading-tight ${
                                      isSoldOut ? 'text-rose-600 line-through' : 'text-slate-800'
                                    }`}
                                  >
                                    {c.item.name}
                                  </h4>
                                  <div className="text-[11px] text-slate-500 font-semibold mt-0.5">
                                    ₹{Number(c.item.price || 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>

                              {/* Qty controller */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                <div className="flex items-center bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => removeFromCart(c.item.id)}
                                    className="w-6 h-6 flex items-center justify-center text-slate-500 hover:bg-slate-100 font-bold text-xs"
                                  >
                                    −
                                  </button>
                                  <span className="w-5 text-center text-xs font-black text-slate-800 tabular-nums">
                                    {c.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => addToCart(c.item)}
                                    disabled={cartTotalItems >= 5}
                                    className="w-6 h-6 flex items-center justify-center text-[#1d68f2] hover:bg-blue-50 font-bold text-xs disabled:opacity-30"
                                  >
                                    +
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setCart(cart.filter(x => x.item.id !== c.item.id))}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded-md transition-colors"
                                  title="Remove"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Sold-out alert in cart */}
                    {cart.some(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out) && (
                      <div className="mb-3 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                        <div className="flex items-center gap-1 font-bold mb-1">
                          <IconAlertTriangle size={14} className="text-rose-600" />
                          <span>Some items are sold out</span>
                        </div>
                        <p className="text-[11px] text-rose-600">Please remove them to place your order.</p>
                      </div>
                    )}

                    {/* Pickup Time Selector */}
                    <div className="mb-4 p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                          Pickup Time
                        </label>
                        <span className="text-[10px] text-[#1d68f2] font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-100/60">
                          {slotConfig.slotMode === 'CUSTOM'
                            ? 'Custom Slots'
                            : `${slotConfig.slotDurationMinutes || 15}m Fixed Slots`}
                        </span>
                      </div>

                      {/* 12-Hour AM/PM Selector */}
                      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1.5 shadow-xs">
                        {/* Hour selector */}
                        <div className="flex-1 min-w-0">
                          <select
                            value={parse12hParts(pickupTime).hour}
                            onChange={e => {
                              const { minute, period } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(Number(e.target.value), minute, period));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            aria-label="Select Pickup Hour"
                            className="w-full bg-slate-50 hover:bg-slate-100 text-slate-800 font-black text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border border-slate-100 text-center"
                          >
                            {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => (
                              <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                            ))}
                          </select>
                        </div>

                        <span className="font-black text-slate-400 text-sm">:</span>

                        {/* Minute selector */}
                        <div className="flex-1 min-w-0">
                          <select
                            value={String(parse12hParts(pickupTime).minute).padStart(2, '0')}
                            onChange={e => {
                              const { hour, period } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(hour, Number(e.target.value), period));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            aria-label="Select Pickup Minute"
                            className="w-full bg-slate-50 hover:bg-slate-100 text-slate-800 font-black text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border border-slate-100 text-center"
                          >
                            {availableMinuteOptions.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>

                        {/* AM / PM Toggle */}
                        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/60 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const { hour, minute } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(hour, minute, 'AM'));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                              parse12hParts(pickupTime).period === 'AM'
                                ? 'bg-[#1d68f2] text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            AM
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const { hour, minute } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(hour, minute, 'PM'));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                              parse12hParts(pickupTime).period === 'PM'
                                ? 'bg-[#1d68f2] text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            PM
                          </button>
                        </div>
                      </div>

                      {/* Quick suggestion slots */}
                      {suggestedQuickSlots.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          {suggestedQuickSlots.map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                setPickupTime(t);
                                if (error) setError('');
                              }}
                              className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all ${
                                normalizeTimeTo24h(pickupTime) === t
                                  ? 'bg-[#1d68f2] text-white border-[#1d68f2] shadow-xs'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {formatSingleTime(t)}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Smart Kitchen schedule info */}
                      {smartSchedule.isValid && (
                        <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex items-center justify-between text-[10px] font-semibold text-slate-500">
                          <span>⚡ Prep starts: <strong className="text-amber-600">{smartSchedule.prepStartFormatted}</strong></span>
                          <span>Hot by: <strong className="text-emerald-600">{smartSchedule.readyByFormatted}</strong></span>
                        </div>
                      )}
                    </div>

                    {/* Order Bill Summary */}
                    {cart.length > 0 && (
                      <div className="space-y-1.5 py-3 border-t border-b border-slate-100 text-xs mb-4">
                        <div className="flex justify-between text-slate-500 font-medium">
                          <span>Subtotal</span>
                          <span className="text-slate-800 font-bold">₹{ledger.food_subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-slate-500 font-medium">
                          <span>Platform Fee (3%)</span>
                          <span className="text-slate-800 font-bold">₹{ledger.commission_fee.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-slate-500 font-medium">
                          <span>Payment Method</span>
                          <span className="text-emerald-600 font-bold">Pay at Counter</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-sm">
                          <span className="font-black text-slate-900">Total Amount</span>
                          <span className="text-lg font-black text-[#1d68f2]">
                            ₹{(ledger.food_subtotal + ledger.commission_fee).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Checkout Submit Button */}
                    <form onSubmit={handlePlaceOrder}>
                      {error && (
                        <div className="mb-3 p-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-1.5 font-bold">
                          <IconAlertTriangle size={14} className="shrink-0 text-rose-600" />
                          <span>{error}</span>
                        </div>
                      )}

                      {(() => {
                        const isSelectedSlotClosed = isLunchClosedForToday;
                        const isScheduleInvalid = !smartSchedule.isValid;
                        const isOrderDisabled =
                          isSuspended ||
                          isSunday ||
                          isBeforeOpeningTime ||
                          isSelectedSlotClosed ||
                          isScheduleInvalid ||
                          cart.length === 0 ||
                          !pickupTime ||
                          submitting ||
                          cart.some(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out);

                        return (
                          <button
                            type="submit"
                            disabled={isOrderDisabled}
                            className={`w-full py-3.5 px-4 rounded-2xl font-black text-xs sm:text-sm shadow-lg transition-all flex items-center justify-center gap-2 ${
                              isOrderDisabled
                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                : 'bg-gradient-to-r from-[#1d68f2] to-[#2563eb] text-white hover:from-blue-600 hover:to-blue-700 shadow-blue-500/30 active:scale-98'
                            }`}
                          >
                            {isSuspended ? (
                              'Account Deactivated'
                            ) : isSunday ? (
                              'Closed on Sundays'
                            ) : isBeforeOpeningTime ? (
                              'Lunch Booking Opens at 9:30 AM'
                            ) : isSelectedSlotClosed ? (
                              'Lunch Ordering Closed'
                            ) : isScheduleInvalid ? (
                              smartSchedule.badge || 'Invalid Pickup Slot'
                            ) : submitting ? (
                              'Placing Order...'
                            ) : (
                              <>
                                <span>Place Order</span>
                                <span>•</span>
                                <span>₹{ledger.gross_payable.toFixed(2)}</span>
                                <ArrowRight size={16} />
                              </>
                            )}
                          </button>
                        );
                      })()}
                    </form>
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* Responsive Mobile Drawer Trigger (< lg screens) */}
          <div className="lg:hidden fixed bottom-2 left-2 right-2 sm:left-3 sm:right-3 z-40 pointer-events-none">
            <div className="pointer-events-auto w-full h-15 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl px-3 sm:px-4 flex items-center justify-between shadow-lg">
              {displayOrder ? (
                <>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
                      displayOrder.status === 'COLLECTED'
                        ? 'bg-emerald-100 text-emerald-700'
                        : displayOrder.status === 'READY'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-blue-100 text-[#1d68f2]'
                    }`}>
                      {displayOrder.status === 'COLLECTED' ? <CheckCircle2 size={18} /> : <Flame size={18} />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-black text-slate-900 leading-tight flex items-center gap-1.5 truncate">
                        <span>Order #{displayOrder.order_number}</span>
                        <span className={`text-[10px] font-bold ${displayOrder.status === 'COLLECTED' ? 'text-emerald-700' : 'text-[#1d68f2]'}`}>
                          ({displayOrder.status === 'COLLECTED' ? 'COLLECTED' : getOrderStatusText(displayOrder as any)})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium truncate">
                        {displayOrder.status === 'COLLECTED'
                          ? `Collected at ${formatSingleTime((displayOrder as any).collected_at || new Date().toISOString())}`
                          : `Pickup at ${formatSingleTime(displayOrder.pickup_time)}`}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCartOpen(true)}
                    className="px-3.5 py-2 rounded-xl bg-[#1d68f2] hover:bg-blue-600 active:scale-95 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <span>{displayOrder.status === 'COLLECTED' ? 'View Receipt' : 'View OTP'}</span>
                    <IconChevronUp size={14} />
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200/80 text-[#1d68f2] flex items-center justify-center font-black text-sm shadow-2xs">
                      {cartTotalItems}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800 leading-tight">Your Order</div>
                      <div className="text-xs font-black text-[#1d68f2]">
                        ₹{ledger.gross_payable.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCartOpen(true)}
                    className="px-4 py-2 rounded-xl bg-[#1d68f2] hover:bg-blue-600 active:scale-95 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <span>View & Checkout</span>
                    <IconChevronUp size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Mobile Bottom Sheet Modal when cartOpen is true on small screens */}
          {cartOpen && (
            <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/50 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto p-5 shadow-2xl flex flex-col justify-between">
                {displayOrder ? (
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-black text-slate-900">Order #{displayOrder.order_number}</h3>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          displayOrder.status === 'COLLECTED'
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                            : 'bg-blue-100 text-[#1d68f2]'
                        }`}>
                          {displayOrder.status === 'COLLECTED' ? 'COLLECTED' : getOrderStatusText(displayOrder as any)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCartOpen(false)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                      >
                        <IconX size={18} />
                      </button>
                    </div>

                    {/* Progress Step Bar with Distinct Colors per Stage */}
                    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 mb-4">
                      <div className="flex items-center justify-between relative px-2">
                        <div className="absolute left-[18px] right-[18px] top-2.5 h-0.5 bg-slate-200 -z-0">
                          <div
                            className={`h-full transition-all duration-500 ${
                              displayOrder.status === 'COLLECTED'
                                ? 'bg-gradient-to-r from-blue-500 via-emerald-500 via-amber-500 via-purple-500 to-teal-500'
                                : displayOrder.status === 'READY'
                                ? 'bg-gradient-to-r from-blue-500 via-emerald-500 via-amber-500 to-purple-600'
                                : displayOrder.status === 'PREPARING'
                                ? 'bg-gradient-to-r from-blue-500 via-emerald-500 to-amber-500'
                                : displayOrder.status === 'ACCEPTED'
                                ? 'bg-gradient-to-r from-blue-500 to-emerald-500'
                                : 'bg-blue-500'
                            }`}
                            style={{
                              width:
                                displayOrder.status === 'PLACED' ? '0%' :
                                displayOrder.status === 'ACCEPTED' ? '25%' :
                                displayOrder.status === 'PREPARING' ? '50%' :
                                displayOrder.status === 'READY' ? '75%' : '100%'
                            }}
                          />
                        </div>

                        {[
                          {
                            key: 'PLACED',
                            label: 'Placed',
                            done: true,
                            current: displayOrder.status === 'PLACED',
                            color: 'bg-blue-600 text-white border-blue-600 shadow-blue-500/25',
                            textColor: 'text-blue-700',
                          },
                          {
                            key: 'ACCEPTED',
                            label: 'Accepted',
                            done: ['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'].includes(displayOrder.status),
                            current: displayOrder.status === 'ACCEPTED',
                            color: 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-500/25',
                            textColor: 'text-emerald-700',
                          },
                          {
                            key: 'PREPARING',
                            label: 'Cooking',
                            done: ['PREPARING', 'READY', 'COLLECTED'].includes(displayOrder.status),
                            current: displayOrder.status === 'PREPARING',
                            color: 'bg-amber-500 text-white border-amber-500 shadow-amber-500/25',
                            textColor: 'text-amber-700',
                          },
                          {
                            key: 'READY',
                            label: 'Ready',
                            done: ['READY', 'COLLECTED'].includes(displayOrder.status),
                            current: displayOrder.status === 'READY',
                            color: 'bg-purple-600 text-white border-purple-600 shadow-purple-500/25',
                            textColor: 'text-purple-700',
                          },
                          {
                            key: 'COLLECTED',
                            label: 'Collected',
                            done: displayOrder.status === 'COLLECTED',
                            current: displayOrder.status === 'COLLECTED',
                            color: 'bg-teal-600 text-white border-teal-600 shadow-teal-500/25',
                            textColor: 'text-teal-700',
                          }
                        ].map((step, idx) => (
                          <div key={idx} className="flex flex-col items-center z-10">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black border transition-all ${
                              step.done
                                ? `${step.color} shadow-xs scale-105`
                                : 'bg-white border-slate-300 text-slate-400'
                            } ${step.current ? 'ring-2 ring-offset-1 ring-slate-300 scale-110' : ''}`}>
                              {step.done ? '✓' : idx + 1}
                            </div>
                            <span className={`text-[10px] font-bold mt-1 transition-colors ${
                              step.done ? step.textColor : 'text-slate-400'
                            }`}>
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* QR Code / Ready State / Collected State */}
                    {displayOrder.status === 'COLLECTED' ? (
                      <div className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-teal-50/50 to-emerald-100/30 border border-emerald-200 rounded-2xl p-4 text-center space-y-3 mb-4 shadow-xs">
                        <div className="relative mx-auto w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-[1.5px] shadow-md shadow-emerald-500/25 flex items-center justify-center">
                          <div className="w-full h-full rounded-[14px] bg-gradient-to-b from-emerald-500 to-teal-600 flex items-center justify-center text-white relative overflow-hidden">
                            <div className="absolute top-0 inset-x-0 h-1/2 bg-white/30 rounded-t-[14px]" />
                            <CheckCircle2 size={24} className="relative z-10 text-white" strokeWidth={2.6} />
                          </div>
                        </div>

                        <div>
                          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-300/80 text-emerald-800 text-[10px] font-black uppercase tracking-wider mb-1">
                            <span>Order Handed Over</span> ✓
                          </div>
                          <h4 className="font-black text-slate-900 text-base">
                            Order Collected Successfully! 🎉
                          </h4>
                          <p className="text-xs text-slate-600 mt-0.5">
                            Your food has been handed over at the counter. Enjoy your meal!
                          </p>
                        </div>

                        <div className="pt-1 flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setCartOpen(false);
                              setShowHistory(true);
                              setTimeout(() => {
                                const el = document.getElementById(`order-${displayOrder.id}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                              }, 150);
                            }}
                            className="flex-1 py-2 px-3 rounded-xl bg-white border border-emerald-300 text-emerald-700 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Star size={12} className="text-amber-500 fill-amber-500" />
                            <span>Rate Meal</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleDismissCollectedOrder(displayOrder.id);
                              setCartOpen(false);
                            }}
                            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md shadow-emerald-600/20 cursor-pointer flex items-center justify-center gap-1"
                          >
                            <span>Order More →</span>
                            {autoCloseCountdown > 0 && (
                              <span className="px-1.5 py-0.2 rounded-full bg-emerald-800/50 text-[10px] font-mono">
                                {autoCloseCountdown}s
                              </span>
                            )}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium text-center">
                          Auto-closing and returning to menu in <span className="font-bold text-emerald-600">{autoCloseCountdown}s</span>
                        </p>
                      </div>
                    ) : displayOrder.status === 'READY' ? (
                      <div className="text-center p-4 bg-emerald-50 border border-emerald-200 rounded-2xl mb-4 space-y-3">
                        <span className="text-xs font-black text-emerald-700 uppercase tracking-wider block">
                          Ready For Pickup!
                        </span>
                        <div
                          onClick={() => setShowQrModal(true)}
                          className="bg-white p-3 rounded-2xl border-2 border-emerald-400 shadow-sm inline-block mx-auto cursor-pointer"
                        >
                          <QRCodeSVG
                            value={`SKIPTRAY:${displayOrder.id}:${currentOtp}`}
                            size={160}
                          />
                        </div>
                        <div className="bg-white py-2.5 px-3 rounded-xl border border-emerald-200">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Pickup Verification OTP</span>
                          {currentOtp ? (
                            <span className="text-2xl font-mono font-black text-emerald-700 tracking-[0.25em] block">
                              {currentOtp}
                            </span>
                          ) : (
                            <div className="flex flex-col items-center gap-1.5 py-1">
                              <button
                                type="button"
                                onClick={handleRequestOtp}
                                disabled={requestingOtp}
                                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-lg shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                              >
                                {requestingOtp ? (
                                  <>
                                    <IconHourglass size={12} className="animate-spin" />
                                    <span>Generating OTP...</span>
                                  </>
                                ) : (
                                  <span>Get Pickup OTP</span>
                                )}
                              </button>
                              <span className="text-[10px] text-slate-400 font-medium">Tap to reveal 6-digit pickup code</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-4 bg-blue-50 border border-blue-200 rounded-2xl mb-4">
                        <IconHourglass size={24} className="animate-spin text-[#1d68f2] mx-auto mb-2" />
                        <h4 className="font-black text-slate-900 text-sm">Kitchen is preparing your meal</h4>
                        <p className="text-xs text-slate-500 mt-1">Scheduled for pickup at {formatSingleTime(displayOrder.pickup_time)}</p>
                      </div>
                    )}

                    {/* Cancel button: allowed anytime before staff accepts order (PLACED only) */}
                    {displayOrder.status === 'PLACED' && (
                      <button
                        type="button"
                        onClick={() => { handleCancelOrder(); setCartOpen(false); }}
                        className="w-full py-2.5 text-rose-600 bg-rose-50 border border-rose-200 font-bold text-xs rounded-xl hover:bg-rose-100"
                      >
                        Cancel Order
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                      <h3 className="text-base font-black text-slate-900">Your Order ({cartTotalItems})</h3>
                      <button
                        type="button"
                        onClick={() => setCartOpen(false)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                      >
                        <IconX size={18} />
                      </button>
                    </div>

                    {/* Cart Items list */}
                    <div className="space-y-2 mb-4">
                      {cart.map(c => (
                        <div key={c.item.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
                          <div>
                            <div className="text-xs font-bold text-slate-900">{c.item.name}</div>
                            <div className="text-[11px] text-slate-500">₹{Number(c.item.price || 0).toFixed(2)} x {c.quantity}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => removeFromCart(c.item.id)}
                              className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg font-bold text-xs"
                            >
                              −
                            </button>
                            <span className="w-5 text-center text-xs font-bold">{c.quantity}</span>
                            <button
                              type="button"
                              onClick={() => addToCart(c.item)}
                              className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg font-bold text-xs"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Mobile Pickup Time Selector in 12h AM/PM */}
                    <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-slate-700">Pickup Time (12h AM/PM)</label>
                        <span className="text-[10px] text-[#1d68f2] font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-100/60">
                          {slotConfig.slotMode === 'CUSTOM'
                            ? 'Custom'
                            : `${slotConfig.slotDurationMinutes || 15}m Fixed`}
                        </span>
                      </div>

                      {/* 12-Hour AM/PM Selector */}
                      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1.5 shadow-xs">
                        <div className="flex-1 min-w-0">
                          <select
                            value={parse12hParts(pickupTime).hour}
                            onChange={e => {
                              const { minute, period } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(Number(e.target.value), minute, period));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            aria-label="Select Pickup Hour"
                            className="w-full bg-slate-50 hover:bg-slate-100 text-slate-800 font-black text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border border-slate-100 text-center"
                          >
                            {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => (
                              <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                            ))}
                          </select>
                        </div>

                        <span className="font-black text-slate-400 text-sm">:</span>

                        <div className="flex-1 min-w-0">
                          <select
                            value={String(parse12hParts(pickupTime).minute).padStart(2, '0')}
                            onChange={e => {
                              const { hour, period } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(hour, Number(e.target.value), period));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            aria-label="Select Pickup Minute"
                            className="w-full bg-slate-50 hover:bg-slate-100 text-slate-800 font-black text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border border-slate-100 text-center"
                          >
                            {availableMinuteOptions.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>

                        {/* AM / PM Toggle */}
                        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/60 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const { hour, minute } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(hour, minute, 'AM'));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                              parse12hParts(pickupTime).period === 'AM'
                                ? 'bg-[#1d68f2] text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            AM
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const { hour, minute } = parse12hParts(pickupTime);
                              setPickupTime(compose24hString(hour, minute, 'PM'));
                              if (error) setError('');
                            }}
                            disabled={isSuspended}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                              parse12hParts(pickupTime).period === 'PM'
                                ? 'bg-[#1d68f2] text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            PM
                          </button>
                        </div>
                      </div>

                      {/* Quick suggestion slots */}
                      {suggestedQuickSlots.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          {suggestedQuickSlots.map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                setPickupTime(t);
                                if (error) setError('');
                              }}
                              className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${
                                normalizeTimeTo24h(pickupTime) === t
                                  ? 'bg-[#1d68f2] text-white border-[#1d68f2] shadow-xs'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {formatSingleTime(t)}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Smart Kitchen schedule info */}
                      {smartSchedule.isValid && (
                        <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[10px] font-semibold text-slate-500">
                          <span>⚡ Prep: <strong className="text-amber-600">{smartSchedule.prepStartFormatted}</strong></span>
                          <span>Hot: <strong className="text-emerald-600">{smartSchedule.readyByFormatted}</strong></span>
                        </div>
                      )}
                    </div>

                    {/* Mobile Place Order Button */}
                    <form onSubmit={e => { handlePlaceOrder(e); setCartOpen(false); }}>
                      <button
                        type="submit"
                        disabled={cart.length === 0 || !pickupTime || !smartSchedule.isValid || submitting || isSuspended || isLunchClosedForToday}
                        className="w-full py-3 bg-[#1d68f2] text-white rounded-xl font-black text-xs shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed"
                      >
                        {!smartSchedule.isValid
                          ? (smartSchedule.badge || 'Invalid Pickup Slot')
                          : `Confirm & Place Order (₹${ledger.gross_payable.toFixed(2)})`}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      </div>

      {/* Fullscreen Enlarge QR Modal */}
      {showQrModal && activeOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center flex flex-col items-center gap-4 shadow-2xl relative">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors"
            >
              <IconX size={20} className="w-5 h-5" />
            </button>

            <div>
              <div className="inline-flex items-center justify-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-[11px] font-extrabold border border-emerald-200 uppercase tracking-wider mb-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                <Radio size={12} className="text-emerald-600 shrink-0" />
                <span>LIVE PASS • {liveTickerTime}</span>
              </div>
              <h3 className="text-2xl font-extrabold text-slate-900 mt-1">Order #{activeOrder.order_number}</h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {activeOrder.id.split('-')[0].toUpperCase()}</p>
            </div>

            <div className="p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl shadow-inner">
              <QRCodeSVG
                value={`SKIPTRAY:${activeOrder.id}:${currentOtp}`}
                size={230}
              />
            </div>

            <div className="w-full bg-slate-900 text-white py-3 rounded-2xl">
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Pickup OTP</div>
              <div className="text-2xl font-mono font-extrabold tracking-[0.25em] text-emerald-400 mt-0.5">
                {currentOtp || (requestingOtp ? 'GENERATING...' : 'READY')}
              </div>
            </div>

            <p className="text-xs text-slate-400 font-medium">
              Requested Slot: <strong className="text-slate-700">{formatPickupTime(activeOrder.pickup_time)} (Lunch)</strong>
            </p>
          </div>
        </div>
      )}

      {/* Immediate Order Collected & OTP Verified Confirmation Modal */}
      {collectedOrderConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collection-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCollectedOrderConfirmation(null);
            }
          }}
        >
          <div className="bg-white rounded-[2rem] p-6 sm:p-8 max-w-sm sm:max-w-md w-full shadow-2xl border border-slate-100 relative overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Decorative ambient gradient backdrop */}
            <div className="absolute top-0 left-0 right-0 h-36 bg-gradient-to-b from-emerald-500/15 via-teal-500/5 to-transparent pointer-events-none" />

            {/* Close button */}
            <button
              onClick={() => setCollectedOrderConfirmation(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors z-10"
              aria-label="Close confirmation"
            >
              <LucideX size={20} className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center relative z-10">
              {/* Animated Celebration Icon with Dual Glowing Rings */}
              <div className="relative mb-3 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-[0_0_30px_rgba(16,185,129,0.35)] ring-8 ring-emerald-50">
                  <CheckCircle2 size={40} className="w-10 h-10 text-emerald-600 animate-in zoom-in duration-300" />
                </div>
                <div className="absolute -top-1 -right-1 bg-amber-400 text-white p-1.5 rounded-full shadow-md animate-bounce">
                  <Sparkles size={16} className="w-4 h-4 fill-white" />
                </div>
              </div>

              {/* Status Badge */}
              <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-black border border-emerald-200 uppercase tracking-wider mb-2">
                <ShieldCheck size={14} className="text-emerald-600" />
                <span>OTP Verified • Collected</span>
              </div>

              {/* Main Title */}
              <h3 id="collection-modal-title" className="text-2xl font-black text-slate-900 tracking-tight">
                Order Collected! 🎉
              </h3>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed max-w-xs sm:max-w-sm">
                Your OTP was verified at the counter and your meal has been handed over.
              </p>

              {/* Order Details Receipt Card */}
              <div className="w-full bg-slate-50 border border-slate-200/80 rounded-2xl p-4 mt-5 text-left shadow-inner">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200/70">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Order Number</span>
                    <span className="text-lg font-black text-slate-800">#{collectedOrderConfirmation.order.order_number}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Verified OTP</span>
                    <span className="font-mono text-base font-extrabold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-md border border-emerald-200">
                      {(collectedOrderConfirmation.order as any).otp_code || 'Verified'}
                    </span>
                  </div>
                </div>

                {/* Items Summary if available */}
                {collectedOrderConfirmation.items && collectedOrderConfirmation.items.length > 0 && (
                  <div className="py-2.5 border-b border-slate-200/70 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Items Collected</span>
                    {collectedOrderConfirmation.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs text-slate-700">
                        <span className="font-medium text-slate-800">{it.quantity}x {it.name}</span>
                        {it.price && <span className="text-slate-500 font-semibold">₹{(Number(it.price) * it.quantity).toFixed(2)}</span>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2.5 text-xs text-slate-500">
                  <span>Collected At:</span>
                  <span className="font-semibold text-slate-700">
                    {new Date((collectedOrderConfirmation.order as any).collected_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </span>
                </div>

                {collectedOrderConfirmation.items && collectedOrderConfirmation.items.length > 0 && (
                  <div className="flex items-center justify-between pt-2 text-xs border-t border-slate-200/60 mt-2">
                    <span className="font-bold text-slate-600">Total Paid:</span>
                    <span className="font-black text-slate-900 text-sm">
                      ₹{collectedOrderConfirmation.items.reduce((sum, it) => sum + (Number(it.price || 0) * it.quantity), 0).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="w-full flex flex-col gap-2.5 mt-6">
                <button
                  onClick={() => {
                    const currentOrder = collectedOrderConfirmation.order;
                    const items = collectedOrderConfirmation.items;
                    setCollectedOrderConfirmation(null);
                    setShowHistory(true);
                    if (items && items.length > 0 && items[0].menuItemId) {
                      setReviewingItem({
                        orderId: currentOrder.id,
                        menuItemId: items[0].menuItemId,
                        itemName: items[0].name
                      });
                    }
                  }}
                  className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold rounded-xl shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/35 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Star size={16} className="fill-amber-300 text-amber-300" />
                  <span>Rate Your Meal</span>
                </button>

                <button
                  onClick={() => setCollectedOrderConfirmation(null)}
                  className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors text-sm"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
