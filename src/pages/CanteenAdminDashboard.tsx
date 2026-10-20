import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, Link } from "react-router-dom";
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPickupTime } from './StudentDashboard';
import { isValidEmail, formatErrorMessage } from '../utils/validation';
import { getItemCategory } from '../lib/menuCategories';
import {
  IconAlertTriangle,
  IconBan,
  IconStar,
  IconSparkles,
  IconClock,
  IconCheckCircle
} from '../components/Icons';
import {
  Search,
  Filter,
  Check,
  LayoutList,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  Clock,
  Package,
  User,
  Users,
  UserPlus,
  Mail,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  Copy,
  Trash2,
  IndianRupee,
  CreditCard,
  Receipt,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  CalendarDays,
  ListFilter,
  Leaf,
  Flame,
  CheckCircle2,
  BarChart3,
  MessageSquare,
  Star,
  ClipboardList,
  ArrowRight,
  Utensils,
  TrendingUp,
  ChefHat,
  Plus,
  Kanban,
  Table
} from 'lucide-react';
import { SalesCollectionDashboard } from '../components/SalesCollectionDashboard';
import {
  calculateOrderTotal,
  getOrderPaymentStatus,
  computeSalesCollectionSummary,
  formatCurrency,
  PaymentStatusType,
} from '../lib/salesAnalytics';
import {
  fetchLunchSlotConfig,
  saveLunchSlotConfig,
  generateSlotsFromConfig,
  LunchSlotConfig,
  DEFAULT_LUNCH_SLOT_CONFIG
} from '../lib/lunchSlots';

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type FoodType = Database['public']['Enums']['food_type'];
type Review = Database['public']['Tables']['item_reviews']['Row'] & {
  menu_items: { name: string } | null;
  profiles: { name: string | null; id_number: string | null } | null;
  orders: { id: string; order_number: number } | null;
};

export default function CanteenAdminDashboard() {
  const { profile } = useAuth();
  const { tenantId } = useTenant();
  const { showAlert, showConfirm } = useDialog();
  const queryClient = useQueryClient();

  const location = useLocation();
  const isOrdersView = location.pathname === '/canteen-admin/orders' || location.search.includes('tab=orders');
  const isMenuView = location.pathname === '/canteen-admin/menu' || location.search.includes('tab=menu');
  const isAnalyticsView = location.pathname === '/canteen-admin/analytics' || location.search.includes('tab=analytics');
  const isStaffView = location.pathname === '/canteen-admin/staff' || location.search.includes('tab=staff');
  const isReviewsView = location.pathname === '/canteen-admin/reviews' || location.search.includes('tab=reviews');
  const isDedicatedView = isOrdersView || isMenuView || isAnalyticsView || isStaffView || isReviewsView;

  const currentTenantId = profile?.tenant_id ?? tenantId ?? null;

  // Fetch available canteens for fallback when profile.canteen_id is not yet set
  const { data: availableCanteens = [] } = useQuery({
    queryKey: ['canteenAdminCanteens', currentTenantId],
    queryFn: async () => {
      let q = supabase.from('canteens').select('id, name, tenant_id');
      if (currentTenantId) q = q.eq('tenant_id', currentTenantId);
      const { data } = await q.order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 60000,
  });

  const currentCanteenId = profile?.canteen_id || availableCanteens[0]?.id || null;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ placed: 0, collected: 0, rejected: 0 });

  // Lunch Pickup Time Slots Management State
  const [slotConfig, setSlotConfig] = useState<LunchSlotConfig>(DEFAULT_LUNCH_SLOT_CONFIG);
  const [slotConfigLoading, setSlotConfigLoading] = useState(true);
  const [savingSlotConfig, setSavingSlotConfig] = useState(false);
  const [slotSaveSuccess, setSlotSaveSuccess] = useState(false);

  // Menu Search & Filter State
  const [menuSearch, setMenuSearch] = useState('');
  const [menuTypeFilter, setMenuTypeFilter] = useState<'ALL' | 'VEG' | 'NON_VEG' | 'PACKED' | 'AVAILABLE' | 'SOLD_OUT'>('ALL');
  const [menuViewMode, setMenuViewMode] = useState<'GRID' | 'TABLE' | 'KANBAN'>('TABLE');
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [orderFilter, setOrderFilter] = useState<'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'ALL'>('TODAY');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'ALL' | PaymentStatusType>('ALL');

  // Order List Filters, Pagination & View
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'REJECTED'>('ALL');
  const [orderViewMode, setOrderViewMode] = useState<'TABLE' | 'CARDS'>('TABLE');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  const orderListRef = useRef<HTMLDivElement>(null);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (orderListRef.current) {
      const rect = orderListRef.current.getBoundingClientRect();
      if (rect.top < 0) {
        orderListRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  // Reset pagination on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [orderSearch, orderStatusFilter, paymentStatusFilter, orderFilter]);

  const toggleExpandOrder = (orderId: string) => {
    setExpandedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  // Live real-time clock for the dashboard
  const [currentDashboardTime, setCurrentDashboardTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentDashboardTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Dedicated query for 60-day orders to compute all 4 sales collection cards and comparative trends
  const { data: salesCollectionOrders = [], isLoading: salesLoading } = useQuery({
    queryKey: ['canteenSalesCollectionOrders', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      sixtyDaysAgo.setHours(0, 0, 0, 0);

      try {
        const { data, error } = await supabase
          .from('orders')
          .select(`
            id, order_number, status, created_at, pickup_time,
            profiles (name, id_number),
            order_items (
              id, quantity,
              menu_items (name, price)
            ),
            order_ledger (
              food_subtotal, gross_payable, payment_status, commission_fee, gateway_fee
            )
          `)
          .eq('canteen_id', currentCanteenId)
          .gte('created_at', sixtyDaysAgo.toISOString())
          .order('created_at', { ascending: false });

        if (!error && data) {
          return (data as any[]) || [];
        }
      } catch (err) {
        console.warn('order_ledger join in collection query fallback:', err);
      }

      const { data: fallbackData } = await supabase
        .from('orders')
        .select(`
          id, order_number, status, created_at, pickup_time,
          profiles (name, id_number),
          order_items (
            id, quantity,
            menu_items (name, price)
          )
        `)
        .eq('canteen_id', currentCanteenId)
        .gte('created_at', sixtyDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      return (fallbackData as any[]) || [];
    },
    refetchInterval: 30000,
  });

  const salesCollectionSummary = useMemo(() => {
    return computeSalesCollectionSummary(salesCollectionOrders);
  }, [salesCollectionOrders]);

  // Fetch orders according to the active timeframe filter
  const { data: allOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['canteenOrders', orderFilter, currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          created_at,
          pickup_time,
          is_takeaway,
          canteen_id,
          tenant_id,
          user_id,
          collected_at,
          profiles (name, id_number),
          order_items (
            id, quantity,
            menu_items (name, price)
          ),
          order_ledger (
            food_subtotal, gross_payable, payment_status, commission_fee, gateway_fee
          )
        `)
        .eq('canteen_id', currentCanteenId);

      const now = new Date();
      if (orderFilter === 'TODAY') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        query = query.gte('created_at', start.toISOString());
      } else if (orderFilter === 'YESTERDAY') {
        const start = new Date(now);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
      } else if (orderFilter === 'LAST_7_DAYS') {
        const start = new Date(now);
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        query = query.gte('created_at', start.toISOString());
      } else if (orderFilter === 'LAST_30_DAYS') {
        const start = new Date(now);
        start.setDate(start.getDate() - 29);
        start.setHours(0, 0, 0, 0);
        query = query.gte('created_at', start.toISOString());
      }

      try {
        const { data, error } = await query.order('created_at', { ascending: false });
        if (!error && data) return (data as any[]) || [];
      } catch (err) {
        console.warn('order_ledger join fallback:', err);
      }

      let fallbackQuery = supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          created_at,
          pickup_time,
          is_takeaway,
          canteen_id,
          tenant_id,
          user_id,
          collected_at,
          profiles (name, id_number),
          order_items (
            id, quantity,
            menu_items (name, price)
          )
        `)
        .eq('canteen_id', currentCanteenId);

      if (orderFilter === 'TODAY') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        fallbackQuery = fallbackQuery.gte('created_at', start.toISOString());
      } else if (orderFilter === 'YESTERDAY') {
        const start = new Date(now);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        fallbackQuery = fallbackQuery.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
      } else if (orderFilter === 'LAST_7_DAYS') {
        const start = new Date(now);
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        fallbackQuery = fallbackQuery.gte('created_at', start.toISOString());
      } else if (orderFilter === 'LAST_30_DAYS') {
        const start = new Date(now);
        start.setDate(start.getDate() - 29);
        start.setHours(0, 0, 0, 0);
        fallbackQuery = fallbackQuery.gte('created_at', start.toISOString());
      }

      const { data: fallbackData } = await fallbackQuery.order('created_at', { ascending: false });
      return (fallbackData as any[]) || [];
    }
  });

  // Status counts across all orders in current time range
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: allOrders.length };
    allOrders.forEach(o => {
      counts[o.status] = (counts[o.status] || 0) + 1;
    });
    return counts;
  }, [allOrders]);

  // Filtered orders with search, status, and payment status
  const filteredAdminOrders = useMemo(() => {
    return allOrders.filter(order => {
      if (orderStatusFilter !== 'ALL' && order.status !== orderStatusFilter) {
        return false;
      }
      if (paymentStatusFilter !== 'ALL') {
        const payInfo = getOrderPaymentStatus(order);
        if (payInfo.status !== paymentStatusFilter) {
          return false;
        }
      }
      if (orderSearch.trim()) {
        const q = orderSearch.toLowerCase().trim();
        const matchNum = String(order.order_number || '').includes(q);
        const matchName = (order.profiles?.name || '').toLowerCase().includes(q);
        const matchId = (order.profiles?.id_number || '').toLowerCase().includes(q);
        const matchShortId = (order.id || '').toLowerCase().includes(q);
        const matchItems = order.order_items?.some((i: any) =>
          (i.menu_items?.name || '').toLowerCase().includes(q)
        );
        const payInfo = getOrderPaymentStatus(order);
        const matchPay = payInfo.label.toLowerCase().includes(q) || payInfo.status.toLowerCase().includes(q);
        const orderTotal = calculateOrderTotal(order);
        const matchAmount = String(orderTotal.totalAmount).includes(q) || String(orderTotal.foodSubtotal).includes(q);

        if (!matchNum && !matchName && !matchId && !matchShortId && !matchItems && !matchPay && !matchAmount) {
          return false;
        }
      }
      return true;
    });
  }, [allOrders, orderStatusFilter, paymentStatusFilter, orderSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredAdminOrders.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAdminOrders.slice(start, start + pageSize);
  }, [filteredAdminOrders, currentPage, pageSize]);

  // Real live active orders (PLACED, ACCEPTED, PREPARING, READY) for executive overview
  const liveActiveOrders = useMemo(() => {
    return allOrders.filter(o => ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status));
  }, [allOrders]);

  // Real today's revenue and average prep duration
  const todayRevenue = salesCollectionSummary?.today?.totalAmount ?? 0;
  const todayOrdersCount = salesCollectionSummary?.today?.orderCount ?? 0;
  const todayComparison = salesCollectionSummary?.today?.percentChange ?? null;
  const todayTrend = salesCollectionSummary?.today?.trend ?? 'NEUTRAL';

  // Real average prep time calculated from slotConfig and menu items
  const avgPrepTimeMinutes = useMemo(() => {
    if (slotConfig?.defaultPrepTimeMinutes) return slotConfig.defaultPrepTimeMinutes;
    const freshItems = menuItems.filter(i => (i as any).prep_time_minutes > 0);
    if (freshItems.length === 0) return 10;
    const total = freshItems.reduce((sum, item) => sum + Number((item as any).prep_time_minutes || 10), 0);
    return Math.round(total / freshItems.length);
  }, [slotConfig, menuItems]);

  // Filtered menu items based on menuSearch and menuTypeFilter
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter(item => {
      // Exclude items that are marked as deleted or archived
      const lowerName = (item.name || '').toLowerCase();
      if (lowerName.includes('[deleted]') || lowerName.includes('[archived]')) {
        return false;
      }

      // Type/Status filter
      if (menuTypeFilter === 'VEG' && item.veg_non_veg !== 'VEG') return false;
      if (menuTypeFilter === 'NON_VEG' && item.veg_non_veg !== 'NON_VEG') return false;
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
      if (menuTypeFilter === 'PACKED' && !isPacked) return false;
      if (menuTypeFilter === 'AVAILABLE' && item.is_sold_out) return false;
      if (menuTypeFilter === 'SOLD_OUT' && !item.is_sold_out) return false;

      // Search query
      if (menuSearch.trim()) {
        const q = menuSearch.toLowerCase().trim();
        const matchName = item.name.toLowerCase().includes(q);
        const matchPrice = String(item.price || '').includes(q);
        const matchType = (item.veg_non_veg || '').toLowerCase().includes(q);
        if (!matchName && !matchPrice && !matchType) return false;
      }

      return true;
    });
  }, [menuItems, menuSearch, menuTypeFilter]);

  const { data: analytics = { mostSold: [] }, isLoading: analyticsLoading } = useQuery({
    queryKey: ['canteenAnalytics', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const { data } = await supabase
        .from('orders')
        .select(`
          status,
          order_items (
            quantity,
            menu_items (name)
          )
        `)
        .eq('canteen_id', currentCanteenId)
        .gte('created_at', startDate.toISOString())
        .neq('status', 'REJECTED');

      const itemCounts: Record<string, number> = {};

      if (data) {
        data.forEach(order => {
          order.order_items?.forEach((item: any) => {
            const name = item.menu_items?.name;
            if (name) {
              itemCounts[name] = (itemCounts[name] || 0) + item.quantity;
            }
          });
        });
      }

      const mostSold = Object.entries(itemCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return { mostSold };
    }
  });

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['canteenReviews', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const { data } = await supabase
        .from('item_reviews')
        .select(`
          *,
          menu_items!inner (name, canteen_id),
          profiles (name, id_number),
          orders (id, order_number)
        `)
        .eq('menu_items.canteen_id', currentCanteenId)
        .order('created_at', { ascending: false });
      return (data as unknown as Review[]) || [];
    }
  });

  const handleReplyToReview = async (reviewId: string) => {
    const trimmedReply = replyText.trim();
    if (!trimmedReply) {
      showAlert({ title: 'Reply Required', message: 'Please write a reply message before submitting.', type: 'warning' });
      return;
    }
    setSubmittingReply(true);

    const { error } = await supabase
      .from('item_reviews')
      .update({ admin_reply: trimmedReply })
      .eq('id', reviewId);

    if (error) {
      showAlert({ title: 'Reply Failed', message: formatErrorMessage(error, 'Failed to submit reply. Please try again.'), type: 'error' });
    } else {
      setReplyingTo(null);
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['canteenReviews'] });
      showAlert({ title: 'Reply Published', message: 'Your reply has been published to the student review.', type: 'success' });
    }
    setSubmittingReply(false);
  };

  const { data: penalizedStudents = [], isLoading: penaltiesLoading } = useQuery({
    queryKey: ['canteenPenalizedStudents', currentTenantId],
    enabled: !!currentTenantId,
    queryFn: async () => {
      let query = supabase
        .from('profiles')
        .select('*')
        .eq('tenant_id', currentTenantId)
        .in('role', ['STUDENT', 'TEACHER'])
        .or('strike_count.gt.0,suspended_until.not.is.null')
        .order('name');
      const { data } = await query;
      return (data as any[]) || [];
    }
  });

  const { data: currentCanteen } = useQuery({
    queryKey: ['canteenDetails', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canteens')
        .select('id, name, code')
        .eq('id', currentCanteenId)
        .maybeSingle();
      if (error) return null;
      return data;
    }
  });

  const { data: staffList = [], isLoading: staffLoading } = useQuery({
    queryKey: ['canteenStaff', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      let locallyDeleted: string[] = [];
      try {
        const stored = localStorage.getItem(`canteen_deleted_staff_${currentCanteenId}`);
        if (stored) locallyDeleted = JSON.parse(stored);
      } catch { }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('canteen_id', currentCanteenId)
        .eq('role', 'STAFF')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching staff members:', error);
        return [];
      }
      return ((data as any[]) || []).filter(
        s => !locallyDeleted.includes(s.id) && !s.name?.startsWith('[DELETED]') && s.id_number !== 'DELETED'
      );
    }
  });

  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [copiedStaffId, setCopiedStaffId] = useState<string | null>(null);

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedStaffId(id);
    setTimeout(() => setCopiedStaffId(null), 2000);
  };

  const filteredStaffList = useMemo(() => {
    let locallyDeleted: string[] = [];
    try {
      const stored = localStorage.getItem(`canteen_deleted_staff_${currentCanteenId}`);
      if (stored) locallyDeleted = JSON.parse(stored);
    } catch { }

    const activeList = staffList.filter(
      s => !locallyDeleted.includes(s.id) && !s.name?.startsWith('[DELETED]') && s.id_number !== 'DELETED'
    );

    if (!staffSearch.trim()) return activeList;
    const q = staffSearch.toLowerCase().trim();
    return activeList.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.id_number || '').toLowerCase().includes(q) ||
      (s.id || '').toLowerCase().includes(q)
    );
  }, [staffList, staffSearch, currentCanteenId]);

  const [deletingStaffId, setDeletingStaffId] = useState<string | null>(null);

  const handleDeleteStaff = async (staffId: string, staffName: string) => {
    const confirmed = await showConfirm({
      title: 'Delete Staff Member',
      message: `Permanently delete "${staffName || 'this staff member'}"? They will immediately lose access to the canteen counter dashboard.`,
      confirmText: 'Delete Staff',
      cancelText: 'Keep Staff',
      isDangerous: true,
    });
    if (!confirmed) return;

    setDeletingStaffId(staffId);
    try {
      let dbDeleted = false;

      // 1. Primary: RPC function canteen_admin_delete_staff (if installed on DB)
      try {
        const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('canteen_admin_delete_staff', { p_staff_id: staffId });
        console.log('[DeleteStaff] RPC result:', { rpcData, rpcError });
        if (!rpcError && (rpcData?.success || rpcData === true)) {
          dbDeleted = true;
        }
      } catch (e: any) {
        console.warn('[DeleteStaff] RPC error:', e);
      }

      // 2. Direct profile delete (if RLS delete policy exists)
      if (!dbDeleted) {
        try {
          const { data: delData, error: delError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', staffId)
            .select();

          console.log('[DeleteStaff] Direct delete result:', { delData, delError });
          if (!delError && delData && delData.length > 0) {
            dbDeleted = true;
          }
        } catch (e: any) {
          console.warn('[DeleteStaff] Direct delete error:', e);
        }
      }

      // 3. Fallback: Deactivate and mark profile so they can no longer access dashboard
      if (!dbDeleted) {
        try {
          await supabase
            .from('profiles')
            .update({
              name: `[DELETED] ${staffName}`,
              id_number: 'DELETED'
            })
            .eq('id', staffId);
        } catch (e: any) {
          console.warn('[DeleteStaff] Profile tag update error:', e);
        }
      }

      // Persist to local canteen deleted IDs list so it never appears again in UI
      try {
        const key = `canteen_deleted_staff_${currentCanteenId}`;
        const stored = localStorage.getItem(key);
        const list: string[] = stored ? JSON.parse(stored) : [];
        if (!list.includes(staffId)) {
          list.push(staffId);
          localStorage.setItem(key, JSON.stringify(list));
        }
      } catch { }

      // Optimistically update React Query cache and invalidate
      queryClient.setQueryData(['canteenStaff', currentCanteenId], (old: any[] = []) =>
        old.filter(s => s.id !== staffId)
      );
      await queryClient.invalidateQueries({ queryKey: ['canteenStaff'] });

      showAlert({
        title: dbDeleted ? 'Staff Account Deleted' : 'Staff Member Removed',
        message: dbDeleted
          ? `"${staffName || 'Staff member'}" account has been permanently deleted from Supabase Authentication and database.`
          : `"${staffName || 'Staff member'}" was removed from the canteen directory. Note: To delete their login account from Supabase Auth, run migration 0037 in your Supabase SQL Editor.`,
        type: 'success'
      });
    } catch (err: any) {
      console.error('Delete staff error:', err);
      showAlert({
        title: 'Delete Failed',
        message: err.message || 'Could not delete staff member.',
        type: 'error'
      });
    } finally {
      setDeletingStaffId(null);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingStaff) return;
    if (!currentCanteenId) {
      showAlert({ title: 'Error', message: 'No canteen selected or assigned to your profile.', type: 'error' });
      return;
    }

    const trimmedName = newStaffName.trim();
    const trimmedEmail = newStaffEmail.trim();

    if (!trimmedName) {
      showAlert({ title: 'Missing Name', message: 'Please enter the staff member\'s full name.', type: 'warning' });
      return;
    }

    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      showAlert({ title: 'Invalid Email', message: 'Please enter a valid staff email address (e.g. staff@institution.edu).', type: 'warning' });
      return;
    }

    if (!newStaffPassword || newStaffPassword.length < 6) {
      showAlert({ title: 'Invalid Password', message: 'Password must be at least 6 characters long.', type: 'warning' });
      return;
    }

    setCreatingStaff(true);
    try {
      const functionsUrl = import.meta.env.VITE_SUPABASE_URL
        ? `${import.meta.env.VITE_SUPABASE_URL.replace('/rest/v1', '')}/functions/v1`
        : 'http://localhost:54321/functions/v1';

      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${functionsUrl}/create-tenant-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          password: newStaffPassword,
          role: 'STAFF',
          canteen_id: currentCanteenId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create staff account');
      }

      showAlert({ title: 'Staff Created', message: `Successfully created staff account for ${trimmedEmail}.`, type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['canteenStaff', currentCanteenId] });

      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      queryClient.invalidateQueries({ queryKey: ['canteenStaff'] });
    } catch (err: any) {
      showAlert({ title: 'Error', message: formatErrorMessage(err, 'Failed to create staff account.'), type: 'error' });
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleResetStudentStrikes = async (studentId: string, studentName: string) => {
    const confirmed = await showConfirm({
      title: 'Reset Strikes & Lift Suspension',
      message: `Clear all strikes and restore full ordering privileges for ${studentName || 'this student'}?`,
      confirmText: 'Reset Strikes',
      cancelText: 'Cancel',
      type: 'info'
    });
    if (!confirmed) return;

    const { error } = await supabase.rpc('admin_reset_student_strikes', { p_student_id: studentId });
    if (error) {
      showAlert({ title: 'Reset Failed', message: `Failed to reset strikes: ${error.message}`, type: 'error' });
      return;
    }
    showAlert({ title: 'Strikes Cleared', message: `Strikes and suspension have been cleared.`, type: 'success' });
    queryClient.invalidateQueries({ queryKey: ['canteenPenalizedStudents'] });
  };

  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemType, setNewItemType] = useState<FoodType>('VEG');
  const [newItemCategory, setNewItemCategory] = useState<'FRESH' | 'PACKED'>('FRESH');
  const [newItemPrepTime, setNewItemPrepTime] = useState('10');
  const [newItemQuantity, setNewItemQuantity] = useState('20');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

  const saveItemMetadata = (itemId: string, meta: { category?: string; prep_time_minutes?: number; stock_quantity?: number | null }, itemName?: string) => {
    try {
      const normalizedNameKey = itemName ? itemName.trim().toLowerCase() : null;
      const key = `canteen_menu_meta_${currentCanteenId}`;
      const existing = localStorage.getItem(key);
      const map = existing ? JSON.parse(existing) : {};
      map[itemId] = { ...(map[itemId] || {}), ...meta };
      if (normalizedNameKey) {
        map[`name:${normalizedNameKey}`] = { ...(map[`name:${normalizedNameKey}`] || {}), ...meta };
      }
      localStorage.setItem(key, JSON.stringify(map));

      const globalMapKey = 'skiptray_menu_meta_global';
      const globalExisting = localStorage.getItem(globalMapKey);
      const globalMap = globalExisting ? JSON.parse(globalExisting) : {};
      globalMap[itemId] = { ...(globalMap[itemId] || {}), ...meta };
      if (normalizedNameKey) {
        globalMap[`name:${normalizedNameKey}`] = { ...(globalMap[`name:${normalizedNameKey}`] || {}), ...meta };
      }
      localStorage.setItem(globalMapKey, JSON.stringify(globalMap));
    } catch {}
  };

  const handleUpdateStock = async (itemId: string, newStock: number) => {
    const stock = Math.max(0, newStock);
    const shouldMarkSoldOut = stock === 0;

    try {
      await (supabase.from('menu_items') as any).update({
        stock_quantity: stock,
        is_sold_out: shouldMarkSoldOut
      }).eq('id', itemId);
    } catch {}

    saveItemMetadata(itemId, { stock_quantity: stock });

    setMenuItems(prev => prev.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          stock_quantity: stock,
          is_sold_out: shouldMarkSoldOut
        } as any;
      }
      return item;
    }));
  };

  useEffect(() => {
    async function loadSlotConfig() {
      setSlotConfigLoading(true);
      const cfg = await fetchLunchSlotConfig(currentCanteenId);
      setSlotConfig(cfg);
      setSlotConfigLoading(false);
    }
    loadSlotConfig();
  }, [currentCanteenId]);

  const generatedSlots = React.useMemo(() => {
    return generateSlotsFromConfig(slotConfig);
  }, [slotConfig]);

  const handleToggleSlot = (slotValue: string) => {
    setSlotConfig(prev => {
      const disabled = new Set(prev.disabledSlots || []);
      if (disabled.has(slotValue)) {
        disabled.delete(slotValue);
      } else {
        disabled.add(slotValue);
      }
      return {
        ...prev,
        disabledSlots: Array.from(disabled),
      };
    });
  };

  const handleToggleAllSlots = (enableAll: boolean) => {
    if (enableAll) {
      setSlotConfig(prev => ({ ...prev, disabledSlots: [] }));
    } else {
      setSlotConfig(prev => ({
        ...prev,
        disabledSlots: generatedSlots.map(s => s.value),
      }));
    }
  };

  const handleSaveSlotConfig = async () => {
    setSavingSlotConfig(true);
    setSlotSaveSuccess(false);

    const [startH, startM] = slotConfig.serviceStartTime.split(':').map(Number);
    const [endH, endM] = slotConfig.serviceEndTime.split(':').map(Number);
    const startMinutes = (startH || 0) * 60 + (startM || 0);
    const endMinutes = (endH || 0) * 60 + (endM || 0);

    if (startMinutes >= endMinutes) {
      showAlert({
        title: 'Invalid Timings',
        message: 'Lunch service end time must be later than the start time.',
        type: 'warning',
      });
      setSavingSlotConfig(false);
      return;
    }

    const res = await saveLunchSlotConfig(slotConfig, currentCanteenId, currentTenantId);
    setSavingSlotConfig(false);

    if (res.success) {
      setSlotSaveSuccess(true);
      setTimeout(() => setSlotSaveSuccess(false), 3500);
      showAlert({
        title: 'Settings Saved',
        message: 'Lunch pickup time slot configuration has been saved successfully!',
        type: 'success',
      });
    } else {
      showAlert({
        title: 'Save Failed',
        message: res.error || 'Failed to save lunch slot configuration.',
        type: 'error',
      });
    }
  };

  const handleResetSlotDefaults = () => {
    setSlotConfig(DEFAULT_LUNCH_SLOT_CONFIG);
  };

  useEffect(() => {
    if (!currentCanteenId) return;

    fetchMenu();
    fetchStats();

    const orderSub = supabase
      .channel('canteen:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `canteen_id=eq.${currentCanteenId}` }, () => {
        fetchStats();
        queryClient.invalidateQueries({ queryKey: ['canteenOrders'] });
        queryClient.invalidateQueries({ queryKey: ['canteenAnalytics'] });
      })
      .subscribe();

    const menuSub = supabase
      .channel('canteen:menu_items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items', filter: `canteen_id=eq.${currentCanteenId}` }, () => {
        fetchMenu();
      })
      .subscribe();

    const reviewSub = supabase
      .channel('canteen:item_reviews')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_reviews' }, () => {
        queryClient.invalidateQueries({ queryKey: ['canteenReviews'] });
      })
      .subscribe();

    const staffSub = supabase
      .channel('canteen:staff')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `canteen_id=eq.${currentCanteenId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['canteenStaff'] });
      })
      .subscribe();

    return () => {
      orderSub.unsubscribe();
      menuSub.unsubscribe();
      reviewSub.unsubscribe();
      staffSub.unsubscribe();
    };
  }, [currentCanteenId, queryClient]);

  const fetchMenu = async () => {
    if (!currentCanteenId) return;
    setLoading(true);
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('canteen_id', currentCanteenId)
      .order('created_at', { ascending: false });
    if (data) {
      const stored = localStorage.getItem(`canteen_deleted_menu_${currentCanteenId}`);
      const deletedIds: string[] = stored ? JSON.parse(stored) : [];

      let metaMap: Record<string, any> = {};
      try {
        const metaStored = localStorage.getItem(`canteen_menu_meta_${currentCanteenId}`);
        const globalMeta = localStorage.getItem('skiptray_menu_meta_global');
        metaMap = {
          ...(globalMeta ? JSON.parse(globalMeta) : {}),
          ...(metaStored ? JSON.parse(metaStored) : {})
        };
      } catch {}

      setMenuItems(data
        .filter(item => {
          if (deletedIds.includes(item.id)) return false;
          const lowerName = (item.name || '').toLowerCase();
          if (lowerName.includes('[deleted]') || lowerName.includes('[archived]')) return false;
          return true;
        })
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

          const resolvedCategory = isPacked ? 'Packed Food' : ((item as any).category || meta.category || 'Meals');

          return {
            ...item,
            category: resolvedCategory,
            prep_time_minutes: (item as any).prep_time_minutes ?? meta.prep_time_minutes ?? (isPacked ? 0 : 10),
            stock_quantity: (item as any).stock_quantity ?? meta.stock_quantity ?? null,
          } as any;
        })
      );
    }
    setLoading(false);
  };

  const fetchStats = async () => {
    if (!currentCanteenId) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: placed } = await supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('canteen_id', currentCanteenId)
      .gte('created_at', today.toISOString());

    const { data: collected } = await supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('canteen_id', currentCanteenId)
      .eq('status', 'COLLECTED')
      .gte('created_at', today.toISOString());

    const { data: rejected } = await supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('canteen_id', currentCanteenId)
      .eq('status', 'REJECTED')
      .gte('created_at', today.toISOString());

    setStats({
      placed: placed?.length || 0,
      collected: collected?.length || 0,
      rejected: rejected?.length || 0
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) {
      showAlert({ title: 'Validation Error', message: 'Item name is required.', type: 'warning' });
      return;
    }
    if (!currentCanteenId || !currentTenantId) {
      showAlert({ title: 'Error', message: 'Canteen or Tenant information missing.', type: 'error' });
      return;
    }

    const trimmedPrice = newItemPrice.trim();
    const parsedPrice = Number(trimmedPrice);

    if (
      trimmedPrice === '' ||
      isNaN(parsedPrice) ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice <= 0
    ) {
      setPriceError('Price must be greater than ₹0.');
      showAlert({
        title: 'Validation Error',
        message: 'Price must be greater than ₹0.',
        type: 'warning'
      });
      return;
    }

    setPriceError(null);

    const isPacked = newItemCategory === 'PACKED';
    const parsedPrepTime = isPacked ? 0 : (Number(newItemPrepTime) || 10);
    const parsedStock = isPacked ? Math.max(0, parseInt(newItemQuantity, 10) || 0) : null;
    const categoryLabel = isPacked ? 'Packed Food' : 'Meals';

    const insertPayload: any = {
      name: newItemName.trim(),
      veg_non_veg: newItemType,
      price: parsedPrice,
      category: categoryLabel,
      prep_time_minutes: parsedPrepTime,
      stock_quantity: parsedStock,
      tenant_id: currentTenantId,
      canteen_id: currentCanteenId
    };

    let { data, error } = await supabase.from('menu_items').insert(insertPayload).select().single();

    // Graceful fallback: If extended columns are not yet present in the remote DB schema, fallback to core columns
    if (error) {
      const fallbackPayload = {
        name: newItemName.trim(),
        veg_non_veg: newItemType,
        price: parsedPrice,
        tenant_id: currentTenantId,
        canteen_id: currentCanteenId
      };
      const retryResult = await (supabase.from('menu_items') as any).insert(fallbackPayload).select().single();
      data = retryResult.data;
      error = retryResult.error;
    }

    if (error) {
      showAlert({ title: 'Error', message: `Failed to add item: ${formatErrorMessage(error)}`, type: 'error' });
      return;
    }

    if (data) {
      const enhancedItem = {
        ...data,
        category: categoryLabel,
        prep_time_minutes: parsedPrepTime,
        stock_quantity: parsedStock,
      };

      saveItemMetadata(data.id, {
        category: categoryLabel,
        prep_time_minutes: parsedPrepTime,
        stock_quantity: parsedStock,
      }, data.name || newItemName.trim());

      setMenuItems([enhancedItem as any, ...menuItems]);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemPrepTime('10');
      setNewItemQuantity('20');
      setPriceError(null);
      setIsAddItemModalOpen(false);
      showAlert({
        title: 'Item Added',
        message: `Successfully added ${newItemName.trim()} (${isPacked ? `Packed Food • Stock: ${parsedStock} pcs` : `Fresh Food • Prep: ${parsedPrepTime}m`}).`,
        type: 'success'
      });
    }
  };

  const handleToggleSoldOut = async (id: string, currentStatus: boolean) => {
    // Instant optimistic update
    setMenuItems(prev => prev.map(item => item.id === id ? { ...item, is_sold_out: !currentStatus } : item));

    const { error } = await supabase.rpc('toggle_sold_out', { item_id: id, new_status: !currentStatus });
    if (error) {
      // Revert if error
      setMenuItems(prev => prev.map(item => item.id === id ? { ...item, is_sold_out: currentStatus } : item));
      showAlert({ title: 'Action Failed', message: `Failed to update sold out status: ${error.message}`, type: 'error' });
    }
  };

  const handleDeleteMenuItem = async (id: string, name: string) => {
    const confirmed = await showConfirm({
      title: 'Delete Menu Item',
      message: `Permanently remove "${name}" from the menu? This cannot be undone.`,
      confirmText: 'Delete Item',
      cancelText: 'Keep Item',
      isDangerous: true,
    });
    if (!confirmed) return;

    let dbDeleted = false;

    // 1. Try RPC function canteen_admin_delete_menu_item (if installed on DB)
    try {
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('canteen_admin_delete_menu_item', { p_item_id: id });
      if (!rpcError && (rpcData?.success || rpcData === true)) {
        dbDeleted = true;
      }
    } catch (e) {
      console.warn('[DeleteMenuItem] RPC note:', e);
    }

    // 2. Try direct delete
    if (!dbDeleted) {
      try {
        const { error } = await supabase
          .from('menu_items')
          .delete()
          .eq('id', id);

        if (!error) {
          dbDeleted = true;
        }
      } catch (e) {
        console.warn('[DeleteMenuItem] Direct delete note:', e);
      }
    }

    // 3. If direct delete is blocked by foreign key (linked to past orders), deactivate in DB
    if (!dbDeleted) {
      try {
        const cleanName = name.replace(/^(\[(?:DELETED|ARCHIVED)\]\s*)+/gi, '').trim();
        await supabase
          .from('menu_items')
          .update({
            is_sold_out: true,
            name: `[DELETED] ${cleanName}`
          })
          .eq('id', id);
      } catch (e) {
        console.warn('[DeleteMenuItem] DB tag note:', e);
      }
    }

    // 4. Persist to local canteen deleted IDs list so it never appears in the UI
    try {
      const key = `canteen_deleted_menu_${currentCanteenId}`;
      const stored = localStorage.getItem(key);
      const list: string[] = stored ? JSON.parse(stored) : [];
      if (!list.includes(id)) {
        list.push(id);
        localStorage.setItem(key, JSON.stringify(list));
      }
    } catch { }

    // 5. Update local state immediately
    setMenuItems(prev => prev.filter(item => item.id !== id));
    queryClient.invalidateQueries({ queryKey: ['menuItems'] });

    showAlert({
      title: 'Item Deleted',
      message: `"${name}" was successfully removed from the menu.`,
      type: 'success'
    });
  };

  const handleCleanArchivedItems = async () => {
    const archivedItems = menuItems.filter(i => i.name.startsWith('[ARCHIVED]') || i.name.startsWith('[DELETED]'));
    if (archivedItems.length === 0) return;

    const confirmed = await showConfirm({
      title: 'Clean Up Archived Items',
      message: `Remove all ${archivedItems.length} archived/test items from the menu view?`,
      confirmText: 'Remove All',
      cancelText: 'Cancel',
      isDangerous: true,
    });
    if (!confirmed) return;

    const key = `canteen_deleted_menu_${currentCanteenId}`;
    const stored = localStorage.getItem(key);
    const list: string[] = stored ? JSON.parse(stored) : [];

    for (const item of archivedItems) {
      if (!list.includes(item.id)) list.push(item.id);
      try {
        await (supabase.rpc as any)('canteen_admin_delete_menu_item', { p_item_id: item.id });
      } catch {}
      try {
        await supabase.from('menu_items').delete().eq('id', item.id);
      } catch {}
      try {
        await supabase.from('menu_items').update({ is_sold_out: true, name: `[DELETED] ${item.name}` }).eq('id', item.id);
      } catch {}
    }

    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {}

    setMenuItems(prev => prev.filter(i => !archivedItems.some(a => a.id === i.id)));
    queryClient.invalidateQueries({ queryKey: ['menuItems'] });

    showAlert({
      title: 'Clean Up Complete',
      message: `Removed ${archivedItems.length} archived items from the menu.`,
      type: 'success'
    });
  };

  if (!currentCanteenId) {
    return <div className="text-center p-8">You are not assigned to any canteen. Please contact your University Admin.</div>;
  }

  return (
    <div className={`w-full ${!isDedicatedView ? 'max-w-7xl h-full flex flex-col' : isMenuView ? 'max-w-6xl' : isOrdersView ? 'max-w-5xl' : 'max-w-4xl'} mx-auto`}>
      {isOrdersView ? (
        /* Dedicated View 1: Order List */
        <>
          {/* Sales Collection Summary Dashboard */}
          <SalesCollectionDashboard
            data={salesCollectionSummary}
            isLoading={salesLoading}
            activePeriod={orderFilter}
            onSelectPeriod={(p) => setOrderFilter(p)}
          />

          {/* Order List */}
          <div ref={orderListRef} className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm">
        {/* Header with Title, Count & Date Range */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-slate-800">Order List</h2>
              <span className="text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                {filteredAdminOrders.length} {filteredAdminOrders.length === 1 ? 'order' : 'orders'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Individual order total calculation, payment status, and food price breakdown
            </p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: 'TODAY', label: "Today" },
              { key: 'YESTERDAY', label: "Yesterday" },
              { key: 'LAST_7_DAYS', label: "Last 7 Days" },
              { key: 'LAST_30_DAYS', label: "Last 30 Days" },
              { key: 'ALL', label: "All Time" }
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setOrderFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${orderFilter === f.key
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Toolbar: Search, View Switcher & Filters */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between mb-4">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by Order #, Student Name, Student ID, or Item..."
              value={orderSearch}
              onChange={e => setOrderSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 placeholder:text-slate-400"
            />
            {orderSearch && (
              <button
                onClick={() => setOrderSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* View Mode Switcher */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-end md:self-auto shrink-0">
            <button
              onClick={() => setOrderViewMode('TABLE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${orderViewMode === 'TABLE'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <LayoutList size={14} />
              <span>Table</span>
            </button>
            <button
              onClick={() => setOrderViewMode('CARDS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${orderViewMode === 'CARDS'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <LayoutGrid size={14} />
              <span>Cards</span>
            </button>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-thin">
          {[
            { key: 'ALL', label: 'All Statuses', count: statusCounts.ALL || 0 },
            { key: 'PLACED', label: 'Placed', count: statusCounts.PLACED || 0 },
            { key: 'ACCEPTED', label: 'Accepted', count: statusCounts.ACCEPTED || 0 },
            { key: 'PREPARING', label: 'Preparing', count: statusCounts.PREPARING || 0 },
            { key: 'READY', label: 'Ready', count: statusCounts.READY || 0 },
            { key: 'COLLECTED', label: 'Collected', count: statusCounts.COLLECTED || 0 },
            { key: 'REJECTED', label: 'Rejected / Cancelled', count: statusCounts.REJECTED || 0 },
          ].map(tab => {
            const isSelected = orderStatusFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setOrderStatusFilter(tab.key as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all border flex items-center gap-1.5 ${isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : tab.count > 0
                      ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60'
                  }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${isSelected
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-200 text-slate-700'
                  }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Payment Status Quick Filter Pills */}
        <div className="flex items-center gap-2 mb-4 text-xs overflow-x-auto pb-1 scrollbar-thin">
          <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] shrink-0">Payment:</span>
          {(['ALL', 'PAID', 'PENDING', 'FAILED', 'REFUNDED'] as const).map(pKey => (
            <button
              key={pKey}
              onClick={() => setPaymentStatusFilter(pKey)}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all border shrink-0 ${paymentStatusFilter === pKey
                  ? pKey === 'PAID'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : pKey === 'FAILED'
                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                      : pKey === 'REFUNDED'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : pKey === 'PENDING'
                          ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                          : 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
            >
              {pKey === 'ALL' ? 'All Payments' : pKey}
            </button>
          ))}
        </div>

        {/* Orders Content Area */}
        {ordersLoading ? (
          <div className="text-slate-500 text-sm py-16 text-center">Loading orders...</div>
        ) : filteredAdminOrders.length === 0 ? (
          <div className="text-slate-500 text-sm py-12 text-center bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
            <Package size={36} className="w-9 h-9 text-slate-300 mx-auto" />
            <div className="font-bold text-slate-700">No orders match the current criteria</div>
            <div className="text-xs text-slate-400">
              {orderSearch ? `No matches found for "${orderSearch}"` : 'Try selecting a different time range or status filter.'}
            </div>
            {(orderSearch || orderStatusFilter !== 'ALL' || paymentStatusFilter !== 'ALL') && (
              <button
                onClick={() => { setOrderSearch(''); setOrderStatusFilter('ALL'); setPaymentStatusFilter('ALL'); }}
                className="mt-2 text-xs font-bold text-emerald-600 hover:text-emerald-800 underline"
              >
                Reset All Filters
              </button>
            )}
          </div>
        ) : orderViewMode === 'TABLE' ? (
          /* High-Density Compact Table View */
          <div className="overflow-hidden rounded-xl border border-slate-200 w-full min-h-[480px]">
            <table className="w-full text-left border-collapse table-fixed">
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[15%]" />
                <col className="w-[11%]" />
                <col className="w-[24%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-2.5 sm:px-3 truncate">Order #</th>
                  <th className="py-2.5 px-2.5 sm:px-3 truncate">Student</th>
                  <th className="py-2.5 px-2 sm:px-3 truncate">Placed At</th>
                  <th className="py-2.5 px-2.5 sm:px-3 truncate">Items Summary</th>
                  <th className="py-2.5 px-2 sm:px-3 text-center truncate">Slot</th>
                  <th className="py-2.5 px-2 sm:px-3 text-center truncate">Status</th>
                  <th className="py-2.5 px-2 sm:px-3 text-center truncate">Payment</th>
                  <th className="py-2.5 px-2.5 sm:px-3 text-right truncate">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedOrders.map(order => {
                  const isExpanded = expandedOrderIds.has(order.id);
                  const orderTotal = calculateOrderTotal(order);
                  const payInfo = getOrderPaymentStatus(order);

                  return (
                    <React.Fragment key={order.id}>
                      <tr
                        onClick={() => toggleExpandOrder(order.id)}
                        className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50/50' : ''
                          }`}
                      >
                        <td className="py-2.5 px-2.5 sm:px-3">
                          <span className="font-extrabold text-slate-900 block truncate">#{order.order_number}</span>
                          <span className="text-[10px] text-slate-400 font-mono block truncate">
                            {order.id.split('-')[0].toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 sm:px-3">
                          <div className="font-semibold text-slate-800 truncate" title={order.profiles?.name || 'Student'}>
                            {order.profiles?.name || 'Student'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono truncate">
                            {order.profiles?.id_number || 'No ID'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-slate-500 text-[11px]">
                          <div className="truncate">{new Date(order.created_at).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
                          <div className="text-slate-400 text-[10px] truncate">
                            {new Date(order.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 sm:px-3 overflow-hidden">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                              {orderTotal.itemCount} {orderTotal.itemCount === 1 ? 'item' : 'items'}
                            </span>
                            <span className="text-slate-600 truncate text-xs flex-1 min-w-0" title={order.order_items?.map((i: any) => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}>
                              {order.order_items?.map((i: any) => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-center">
                          <span className="font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] truncate inline-block max-w-full">
                            {formatPickupTime(order.pickup_time)}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-center">
                          <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border truncate inline-block max-w-full ${order.status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' :
                              order.status === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                  order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                    order.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                                      'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                            {order.status === 'REJECTED'
                              ? ((order as any).cancellation_reason === 'USER_CANCELLED' || (order as any).cancellation_reason?.toLowerCase().includes('cancel') ? 'CANCELLED' : 'REJECTED')
                              : order.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-center">
                          <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border truncate inline-block max-w-full ${payInfo.badgeClass}`}>
                            {payInfo.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 sm:px-3 text-right">
                          <div className="flex items-center justify-end gap-1 min-w-0">
                            <div className="text-right truncate min-w-0">
                              <div className="font-black text-slate-900 text-xs sm:text-sm truncate">
                                {formatCurrency(orderTotal.totalAmount)}
                              </div>
                              {orderTotal.additionalCharges > 0 && (
                                <div className="text-[10px] text-slate-400 truncate">
                                  Food: {formatCurrency(orderTotal.foodSubtotal)}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpandOrder(order.id); }}
                              className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-slate-100 transition-colors shrink-0"
                              title="Toggle order price breakdown"
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/70 border-b border-slate-200">
                          <td colSpan={8} className="p-4">
                            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs">
                              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-slate-100 pb-2">
                                <span className="font-bold text-slate-800 text-xs">
                                  Order #{order.order_number} Itemized Breakdown
                                </span>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-slate-500">
                                    Payment: <strong className="text-slate-800">{payInfo.label}</strong>
                                  </span>
                                  <span className="text-slate-300">|</span>
                                  <span className="font-extrabold text-emerald-700 text-sm">
                                    Total: {formatCurrency(orderTotal.totalAmount)}
                                  </span>
                                </div>
                              </div>

                              {/* Items Breakdown List */}
                              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {order.order_items?.map((item: any) => {
                                  const itemQty = Number(item.quantity) || 1;
                                  const itemUnitPrice = Number(item.menu_items?.price ?? item.price ?? 0);
                                  const itemSubtotal = itemQty * itemUnitPrice;

                                  return (
                                    <li key={item.id} className="flex justify-between items-center bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs">
                                      <div className="flex items-center gap-2 truncate">
                                        <span className="font-black bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                                          {itemQty}x
                                        </span>
                                        <span className="font-semibold text-slate-700 truncate">{item.menu_items?.name || 'Item'}</span>
                                      </div>
                                      <div className="text-right pl-2 shrink-0">
                                        <div className="text-slate-700 font-bold font-mono text-[11px]">
                                          {formatCurrency(itemSubtotal)}
                                        </div>
                                        <div className="text-[10px] text-slate-400">
                                          @{formatCurrency(itemUnitPrice, false)}/ea
                                        </div>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>

                              {/* Cost Breakdown Details */}
                              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap justify-between items-center gap-3 text-xs bg-slate-50/50 p-3 rounded-lg">
                                <div className="space-y-0.5 text-slate-600">
                                  <div>Food Subtotal: <strong className="text-slate-800">{formatCurrency(orderTotal.foodSubtotal)}</strong></div>
                                  {orderTotal.additionalCharges > 0 && (
                                    <div>Taxes &amp; Fees: <strong className="text-slate-800">{formatCurrency(orderTotal.additionalCharges)}</strong></div>
                                  )}
                                  {orderTotal.discountAmount > 0 && (
                                    <div className="text-emerald-700">Discount Applied: <strong>-{formatCurrency(orderTotal.discountAmount)}</strong></div>
                                  )}
                                </div>
                                <div className="text-right">
                                  <span className="text-[11px] text-slate-400 uppercase font-bold block">Final Order Amount</span>
                                  <span className="text-base font-black text-emerald-700">
                                    {formatCurrency(orderTotal.totalAmount)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Responsive Card Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 min-h-[480px]">
            {paginatedOrders.map(order => {
              const orderTotal = calculateOrderTotal(order);
              const payInfo = getOrderPaymentStatus(order);

              return (
                <div key={order.id} className="p-5 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between gap-3 hover:border-emerald-300 transition-all shadow-sm">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-bold text-slate-900 text-base">Order #{order.order_number}</h3>
                        <div className="text-[11px] text-slate-400 font-mono">ID: {order.id.split('-')[0].toUpperCase()}</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${order.status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' :
                            order.status === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                              order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  order.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                                    'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                          {order.status === 'REJECTED'
                            ? ((order as any).cancellation_reason === 'USER_CANCELLED' || (order as any).cancellation_reason?.toLowerCase().includes('cancel') ? 'CANCELLED' : 'REJECTED')
                            : order.status}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${payInfo.badgeClass}`}>
                          {payInfo.label}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-slate-700 mb-1">
                      <span className="font-semibold">{order.profiles?.name || 'Student'}</span>
                      <span className="text-slate-400 font-mono ml-1.5">({order.profiles?.id_number || 'No ID'})</span>
                    </div>

                    <div className="text-xs text-indigo-600 font-bold bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 inline-block mb-3">
                      Pickup: {formatPickupTime(order.pickup_time)}
                    </div>

                    {/* Food Items Breakdown */}
                    <div className="pt-2.5 border-t border-slate-100">
                      <ul className="space-y-1">
                        {order.order_items?.map((item: any) => {
                          const itemQty = Number(item.quantity) || 1;
                          const itemUnitPrice = Number(item.menu_items?.price ?? item.price ?? 0);
                          return (
                            <li key={item.id} className="text-xs text-slate-700 flex justify-between">
                              <span className="truncate pr-2">
                                <span className="font-bold text-slate-900">{itemQty}x</span> {item.menu_items?.name || 'Item'}
                              </span>
                              <span className="text-slate-500 font-mono text-[11px] shrink-0">
                                {formatCurrency(itemUnitPrice * itemQty)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>

                  {/* Card Footer: Amount and Timestamp */}
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div className="flex justify-between items-baseline">
                      <div className="text-xs text-slate-500">
                        {orderTotal.additionalCharges > 0 && (
                          <span>Food: {formatCurrency(orderTotal.foodSubtotal)} • </span>
                        )}
                        <span>{orderTotal.itemCount} items</span>
                      </div>
                      <div className="text-right">
                        <span className="text-base font-black text-slate-900">
                          {formatCurrency(orderTotal.totalAmount)}
                        </span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 flex justify-between pt-1 border-t border-slate-50">
                      <span>{new Date(order.created_at).toLocaleDateString()}</span>
                      <span>{new Date(order.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar */}
        {filteredAdminOrders.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to{' '}
                <strong>{Math.min(currentPage * pageSize, filteredAdminOrders.length)}</strong> of{' '}
                <strong>{filteredAdminOrders.length}</strong> orders
              </span>
              <span className="text-slate-300">|</span>
              <label className="flex items-center gap-1.5">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); handlePageChange(1); }}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); handlePageChange(Math.max(1, currentPage - 1)); }}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    return (
                      <React.Fragment key={p}>
                        {prev && p - prev > 1 && (
                          <span className="px-1 text-slate-400">...</span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); handlePageChange(p); }}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${currentPage === p
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          {p}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button
                type="button"
                onClick={(e) => { e.preventDefault(); handlePageChange(Math.min(totalPages, currentPage + 1)); }}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  ) : isMenuView ? (
    /* Dedicated View 2: Manage Menu (Exact Match to Design Screenshot) */
    <div className="col-span-12 flex flex-col gap-5 w-full">
      {/* 1. Top Hero Banner (Rich Dark Thematic Banner) */}
      <div className="relative overflow-hidden rounded-[1.75rem] bg-[#0b192e] text-white p-6 sm:p-8 shadow-xl border border-slate-800">
        {/* Ambient background glows */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-xl">
            <span className="text-[10px] sm:text-xs font-black tracking-widest uppercase text-slate-400 block mb-1">
              CANTEEN MANAGEMENT
            </span>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white flex items-center gap-2">
              <span>Manage</span>
              <span className="text-[#38bdf8]">Menu</span>
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-300 font-medium">
              Add, edit and manage your canteen menu items easily.
            </p>

            {/* Feature Pills */}
            <div className="flex flex-wrap items-center gap-2 mt-4 sm:mt-5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-700/70 text-[11px] font-semibold text-slate-200 backdrop-blur-xs">
                <Leaf size={12} className="text-emerald-400" />
                <span>Fresh & Healthy Food</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-700/70 text-[11px] font-semibold text-slate-200 backdrop-blur-xs">
                <Flame size={12} className="text-amber-400" />
                <span>Great Taste</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-700/70 text-[11px] font-semibold text-slate-200 backdrop-blur-xs">
                <Sparkles size={12} className="text-sky-400" />
                <span>Happy Customers</span>
              </span>
            </div>
          </div>

          {/* Right Hero Food Image Card with "Good Food Always" handwritten text */}
          <div className="relative shrink-0 flex items-center justify-center self-center lg:self-auto">
            <div className="relative w-72 sm:w-80 h-36 sm:h-40 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 group">
              <img
                src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80"
                alt="Delicious Indian Food"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            </div>

            {/* Handwritten overlay script */}
            <div className="hidden sm:block absolute -right-3 -top-2 text-right pointer-events-none transform rotate-3 select-none">
              <span className="block font-serif italic text-white/90 text-sm font-bold drop-shadow">
                Good<br />Food<br />Always
              </span>
              <span className="text-rose-400 text-xs">♥</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Main White Container Card */}
      <div className="bg-white border border-slate-100 rounded-[2rem] p-5 sm:p-7 shadow-sm flex flex-col gap-5">
        {/* Top Header: Purple Chef Icon + Title + Count Badge + Action Buttons */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#6366f1] text-white flex items-center justify-center shadow-md shadow-indigo-500/25">
              <ChefHat size={22} strokeWidth={2.2} />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                Manage Menu
              </h2>
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {filteredMenuItems.length} {filteredMenuItems.length === 1 ? 'item' : 'items'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Embedded Quick-Add Food Bar */}
        <form onSubmit={handleAddItem} className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 flex flex-col gap-3">
          {/* Category Toggle Row */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              <LayoutGrid size={14} className="text-slate-400" />
              <span>Category</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setNewItemCategory('FRESH')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 ${
                  newItemCategory === 'FRESH'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Leaf size={12} className={newItemCategory === 'FRESH' ? 'text-white' : 'text-emerald-600'} />
                <span>Fresh Food</span>
              </button>

              <button
                type="button"
                onClick={() => setNewItemCategory('PACKED')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 ${
                  newItemCategory === 'PACKED'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Package size={12} className={newItemCategory === 'PACKED' ? 'text-white' : 'text-purple-600'} />
                <span>Packed Food</span>
              </button>
            </div>
          </div>

          {/* Input Row: Food Name + Price + Prep Time/Qty + Veg Selector + Add Button */}
          <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
            {/* Food Name Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Utensils size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={newItemCategory === 'FRESH' ? 'Enter food name (e.g., Sambar Rice, KFC Chicken, Paneer Dosa, Meals)' : 'Enter food name (e.g., Lays Classic, Oreo Biscuits, Amul Lassi)'}
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                maxLength={100}
                className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Price Input */}
            <div className="relative w-28 sm:w-32 shrink-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">₹</span>
              <input
                type="number"
                placeholder="Price (₹)"
                value={newItemPrice}
                onChange={(e) => {
                  setNewItemPrice(e.target.value);
                  if (priceError) setPriceError(null);
                }}
                min="0.01"
                step="any"
                className={`w-full pl-7 pr-3 py-2.5 bg-white border ${priceError ? 'border-rose-400 ring-1 ring-rose-400' : 'border-slate-200'} rounded-xl text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500`}
              />
            </div>

            {/* Prep Time or Stock Input */}
            {newItemCategory === 'FRESH' ? (
              <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shrink-0">
                <Clock size={13} className="text-slate-400" />
                <div className="flex flex-col">
                  <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">PREP TIME</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      placeholder="10"
                      value={newItemPrepTime}
                      onChange={(e) => setNewItemPrepTime(e.target.value)}
                      min="1"
                      max="60"
                      className="w-8 text-xs font-black text-slate-800 text-center border-none p-0 focus:ring-0"
                    />
                    <span className="text-[10px] font-bold text-slate-500">mins</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shrink-0">
                <Package size={13} className="text-purple-600" />
                <div className="flex flex-col">
                  <span className="text-[8px] font-black uppercase text-purple-600 tracking-wider">QTY</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      placeholder="20"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(e.target.value)}
                      min="0"
                      max="1000"
                      className="w-10 text-xs font-black text-slate-800 text-center border-none p-0 focus:ring-0"
                    />
                    <span className="text-[10px] font-bold text-slate-500">pcs</span>
                  </div>
                </div>
              </div>
            )}

            {/* Veg / Non-Veg Dropdown */}
            <div className="shrink-0">
              <select
                value={newItemType}
                onChange={(e) => setNewItemType(e.target.value as FoodType)}
                className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="VEG">🟢 Veg</option>
                <option value="NON_VEG">🔴 Non-Veg</option>
              </select>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-sm transition shrink-0 cursor-pointer active:scale-95 whitespace-nowrap"
            >
              <Plus size={15} strokeWidth={2.5} />
              <span>Add {newItemCategory === 'FRESH' ? 'Fresh Food' : 'Packed Food'}</span>
            </button>
          </div>
          {priceError && (
            <p className="text-xs text-rose-600 font-semibold">{priceError}</p>
          )}
        </form>

        {/* 4. Search and Filter Toolbar (Exact Match to Design Screenshot) */}
        <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by item name, price, or category..."
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {menuSearch && (
              <button
                type="button"
                onClick={() => setMenuSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter Pill Buttons Row */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {([
              { key: 'ALL', label: 'All', icon: ListFilter, iconColor: 'text-slate-500' },
              { key: 'VEG', label: 'Veg', icon: Leaf, iconColor: 'text-emerald-500' },
              { key: 'NON_VEG', label: 'Non-Veg', icon: Flame, iconColor: 'text-rose-500' },
              { key: 'PACKED', label: 'Packed', icon: Package, iconColor: 'text-purple-500' },
              { key: 'AVAILABLE', label: 'Available', icon: CheckCircle2, iconColor: 'text-emerald-500' },
              { key: 'SOLD_OUT', label: 'Sold Out', icon: IconBan, iconColor: 'text-rose-500' }
            ] as const).map(({ key, label, icon: IconComp, iconColor }) => {
              const isSelected = menuTypeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMenuTypeFilter(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all border inline-flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <IconComp size={13} className={isSelected ? 'text-white' : iconColor} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          {/* View Mode Toggle: Grid, Table, Kanban */}
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 shrink-0">
            <button
              type="button"
              onClick={() => setMenuViewMode('GRID')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                menuViewMode === 'GRID'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Grid / Card View"
            >
              <LayoutGrid size={13} />
              <span>Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setMenuViewMode('TABLE')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                menuViewMode === 'TABLE'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Table View"
            >
              <Table size={13} />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setMenuViewMode('KANBAN')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                menuViewMode === 'KANBAN'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Kanban Board View"
            >
              <Kanban size={13} />
              <span>Kanban</span>
            </button>
          </div>
        </div>

        {/* 5. Menu Items Views Container: Grid, Table, or Kanban */}
        <div>
          {loading ? (
            <div className="text-slate-500 text-sm py-12 text-center">Loading menu items...</div>
          ) : filteredMenuItems.length === 0 ? (
            <div className="text-slate-400 text-sm text-center py-12 bg-slate-50/70 rounded-2xl border border-slate-100">
              {menuSearch || menuTypeFilter !== 'ALL'
                ? 'No menu items match your search or filter.'
                : 'No menu items for this location yet.'}
            </div>
          ) : menuViewMode === 'TABLE' ? (
            /* Table View */
            <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 text-[11px] font-extrabold uppercase tracking-wider">
                    <th className="py-3 px-4">Item Name</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Price</th>
                    <th className="py-3 px-3">Prep / Stock</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMenuItems.map((item) => {
                    const rawCat = String((item as any).category || '').toLowerCase();
                    const isPacked =
                      rawCat === 'packed food' ||
                      rawCat === 'packed' ||
                      rawCat === 'packaged' ||
                      rawCat === 'snacks' ||
                      rawCat === 'snack' ||
                      rawCat.includes('pack') ||
                      (item as any).stock_quantity != null ||
                      (item.name || '').toLowerCase().includes('packed') ||
                      getItemCategory(item) === 'Packed Food';
                    const stock = (item as any).stock_quantity ?? null;
                    const prepMinutes = (item as any).prep_time_minutes ?? (isPacked ? 0 : 10);
                    const isItemSoldOut = item.is_sold_out || (isPacked && stock !== null && stock <= 0);
                    const isVeg = item.veg_non_veg === 'VEG';

                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-slate-50/60 transition-colors ${
                          isItemSoldOut ? 'bg-slate-50/40 text-slate-400' : 'text-slate-700'
                        }`}
                      >
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isVeg ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-rose-500 ring-2 ring-rose-200'
                              }`}
                            />
                            <span className="capitalize">{item.name}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              isVeg ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-rose-50 text-rose-700 border border-rose-200/60'
                            }`}
                          >
                            {isVeg ? 'Veg' : 'Non-Veg'}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              isPacked
                                ? 'bg-purple-50 text-purple-700 border border-purple-200/60'
                                : 'bg-blue-50 text-blue-700 border border-blue-200/60'
                            }`}
                          >
                            {isPacked ? <Package size={11} /> : <Utensils size={11} />}
                            <span>{isPacked ? 'Packed Food' : 'Fresh Food'}</span>
                          </span>
                        </td>
                        <td className="py-3.5 px-3 font-black text-[#1d68f2]">
                          ₹{Number(item.price || 0).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-3">
                          {isPacked ? (
                            <div className="inline-flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-0.5">
                              <button
                                type="button"
                                onClick={() => handleUpdateStock(item.id, Math.max(0, (stock ?? 0) - 1))}
                                className="w-5 h-5 rounded bg-white hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs"
                              >
                                -
                              </button>
                              <span className="w-6 text-center text-xs font-black text-slate-800">{stock ?? 0}</span>
                              <button
                                type="button"
                                onClick={() => handleUpdateStock(item.id, (stock ?? 0) + 1)}
                                className="w-5 h-5 rounded bg-white hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs"
                              >
                                +
                              </button>
                              <span className="text-[10px] text-slate-400 font-bold">pcs</span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-md">
                              <Clock size={11} />
                              {prepMinutes} mins
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              isItemSoldOut
                                ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {isItemSoldOut ? 'Sold Out' : 'Available'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleSoldOut(item.id, isItemSoldOut)}
                              className={`px-3 py-1 rounded-full font-bold text-xs transition cursor-pointer ${
                                isItemSoldOut
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : 'bg-rose-600 hover:bg-rose-700 text-white'
                              }`}
                            >
                              {isItemSoldOut ? 'Available' : 'Sold Out'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMenuItem(item.id, item.name)}
                              className="w-8 h-8 rounded-full border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition cursor-pointer"
                              title="Delete item"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : menuViewMode === 'KANBAN' ? (
            /* Kanban Board View (Grouped by Available vs Sold Out) */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Column 1: Available Items */}
              <div className="bg-slate-50/80 rounded-2xl border border-slate-200/80 p-4 flex flex-col">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <h3 className="font-extrabold text-sm text-slate-800">Available ({filteredMenuItems.filter(i => {
                      const isPacked = getItemCategory(i) === 'Packed Food';
                      const stock = (i as any).stock_quantity ?? null;
                      return !i.is_sold_out && !(isPacked && stock !== null && stock <= 0);
                    }).length})</h3>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Active on App</span>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[700px] pr-1">
                  {filteredMenuItems.filter(i => {
                    const isPacked = getItemCategory(i) === 'Packed Food';
                    const stock = (i as any).stock_quantity ?? null;
                    return !i.is_sold_out && !(isPacked && stock !== null && stock <= 0);
                  }).map(item => {
                    const rawCat = String((item as any).category || '').toLowerCase();
                    const isPacked =
                      rawCat === 'packed food' ||
                      rawCat === 'packed' ||
                      rawCat === 'packaged' ||
                      rawCat === 'snacks' ||
                      rawCat === 'snack' ||
                      rawCat.includes('pack') ||
                      (item as any).stock_quantity != null ||
                      (item.name || '').toLowerCase().includes('packed') ||
                      getItemCategory(item) === 'Packed Food';
                    const stock = (item as any).stock_quantity ?? null;
                    const prepMinutes = (item as any).prep_time_minutes ?? (isPacked ? 0 : 10);
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
                              <span className="text-slate-300">•</span>
                              <span className="text-[10px] font-bold text-slate-500">{isPacked ? 'Packed' : `${prepMinutes}m prep`}</span>
                            </div>
                            <h4 className="font-extrabold text-sm text-slate-900 capitalize">{item.name}</h4>
                          </div>
                          <span className="text-sm font-black text-[#1d68f2]">₹{Number(item.price || 0).toFixed(2)}</span>
                        </div>

                        {isPacked && (
                          <div className="flex items-center justify-between bg-slate-50 rounded-lg px-2 py-1 text-xs">
                            <span className="text-[10px] font-bold text-slate-500">Stock</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdateStock(item.id, Math.max(0, (stock ?? 0) - 1))}
                                className="w-5 h-5 rounded bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs"
                              >
                                -
                              </button>
                              <span className="w-6 text-center text-xs font-black text-slate-800">{stock ?? 0}</span>
                              <button
                                type="button"
                                onClick={() => handleUpdateStock(item.id, (stock ?? 0) + 1)}
                                className="w-5 h-5 rounded bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleDeleteMenuItem(item.id, item.name)}
                            className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition"
                          >
                            <Trash2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleSoldOut(item.id, false)}
                            className="px-3 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold transition flex items-center gap-1"
                          >
                            <IconBan size={12} />
                            <span>Mark Sold Out</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Column 2: Sold Out Items */}
              <div className="bg-rose-50/30 rounded-2xl border border-rose-100 p-4 flex flex-col">
                <div className="flex items-center justify-between pb-3 border-b border-rose-100 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <h3 className="font-extrabold text-sm text-slate-800">Sold Out ({filteredMenuItems.filter(i => {
                      const isPacked = getItemCategory(i) === 'Packed Food';
                      const stock = (i as any).stock_quantity ?? null;
                      return i.is_sold_out || (isPacked && stock !== null && stock <= 0);
                    }).length})</h3>
                  </div>
                  <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">Hidden / Disabled</span>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[700px] pr-1">
                  {filteredMenuItems.filter(i => {
                    const isPacked = getItemCategory(i) === 'Packed Food';
                    const stock = (i as any).stock_quantity ?? null;
                    return i.is_sold_out || (isPacked && stock !== null && stock <= 0);
                  }).map(item => {
                    const rawCat = String((item as any).category || '').toLowerCase();
                    const isPacked =
                      rawCat === 'packed food' ||
                      rawCat === 'packed' ||
                      rawCat === 'packaged' ||
                      rawCat === 'snacks' ||
                      rawCat === 'snack' ||
                      rawCat.includes('pack') ||
                      (item as any).stock_quantity != null ||
                      (item.name || '').toLowerCase().includes('packed') ||
                      getItemCategory(item) === 'Packed Food';
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
                              <span className="text-[10px] font-bold text-rose-600 font-bold">Sold Out</span>
                            </div>
                            <h4 className="font-extrabold text-sm text-slate-800 capitalize line-through">{item.name}</h4>
                          </div>
                          <span className="text-sm font-bold text-slate-400">₹{Number(item.price || 0).toFixed(2)}</span>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleDeleteMenuItem(item.id, item.name)}
                            className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition"
                          >
                            <Trash2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleSoldOut(item.id, true)}
                            className="px-3 py-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1 shadow-xs"
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
            /* Grid / Card Layout (Default) */
            <div className="space-y-3">
              {filteredMenuItems.map((item, idx) => {
                const rawCat = String((item as any).category || '').toLowerCase();
                const isPacked =
                  rawCat === 'packed food' ||
                  rawCat === 'packed' ||
                  rawCat === 'packaged' ||
                  rawCat === 'snacks' ||
                  rawCat === 'snack' ||
                  rawCat.includes('pack') ||
                  (item as any).stock_quantity != null ||
                  (item.name || '').toLowerCase().includes('packed') ||
                  getItemCategory(item) === 'Packed Food';
                const stock = (item as any).stock_quantity ?? null;
                const prepMinutes = (item as any).prep_time_minutes ?? (isPacked ? 0 : 10);
                const isItemSoldOut = item.is_sold_out || (isPacked && stock !== null && stock <= 0);
                const isVeg = item.veg_non_veg === 'VEG';

                // Determine theme accent matching user reference image
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
                      isItemSoldOut ? 'opacity-70 bg-slate-50 grayscale-20' : ''
                    }`}
                  >
                    <div>
                      {/* Top Row: Badges matching user reference */}
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
                              <span>{prepMinutes}m prep</span>
                            </div>
                          )}
                        </div>

                        {/* Right Tag */}
                        {isItemSoldOut ? (
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

                    {/* Stock counter if packed */}
                    {isPacked && (
                      <div className="flex items-center justify-between bg-white/80 border border-slate-200/70 rounded-xl px-3 py-1.5 my-2">
                        <span className="text-[11px] font-bold text-slate-600 uppercase">Inventory Stock</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleUpdateStock(item.id, Math.max(0, (stock ?? 0) - 1))}
                            className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs"
                          >
                            -
                          </button>
                          <span className="w-8 text-center text-xs font-black text-slate-900">{stock ?? 0}</span>
                          <button
                            type="button"
                            onClick={() => handleUpdateStock(item.id, (stock ?? 0) + 1)}
                            className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Footer: Price on Left, Action Buttons on Right */}
                    <div className="pt-4 border-t border-slate-200/70 flex items-center justify-between gap-3 mt-3">
                      <div>
                        <span className="text-[10px] tracking-wider font-extrabold text-slate-400 block uppercase">
                          PRICE
                        </span>
                        <div className="text-2xl font-black text-[#1d68f2] tracking-tight">
                          ₹{Number(item.price || 0).toFixed(2)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDeleteMenuItem(item.id, item.name)}
                          className="w-9 h-9 rounded-full border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition cursor-pointer"
                          title="Delete item"
                        >
                          <Trash2 size={15} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleSoldOut(item.id, isItemSoldOut)}
                          className={`px-4 py-2 rounded-full font-extrabold text-xs transition-all shadow-md flex items-center gap-1.5 cursor-pointer ${
                            isItemSoldOut
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/25'
                              : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/25'
                          }`}
                        >
                          <IconBan size={13} />
                          <span>{isItemSoldOut ? 'Available' : 'Sold Out'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 6. Footer Brand Pill Bar */}
      <div className="flex items-center justify-center sm:justify-between flex-wrap gap-3 py-2 text-slate-400 text-xs font-semibold px-2">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Leaf size={14} className="text-emerald-500" />
            <span>Fresh Ingredients</span>
          </span>
          <span>|</span>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Star size={14} className="text-amber-500" />
            <span>Hygienic Food</span>
          </span>
          <span>|</span>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Sparkles size={14} className="text-blue-500" />
            <span>Happy Customers</span>
          </span>
        </div>

        <div className="font-serif italic font-bold text-blue-600 text-sm flex items-center gap-1">
          <span>Better Food, Better Day.</span>
          <span>♡</span>
        </div>
      </div>

      {/* 7. Modal for "Add New Item" */}
      {isAddItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                  <ChefHat size={18} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Add New Menu Item</h3>
                  <p className="text-xs text-slate-400">Add a dish to your live canteen menu</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddItemModalOpen(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-4">
              {/* Category */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wider">Category</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewItemCategory('FRESH')}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition ${
                      newItemCategory === 'FRESH'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Leaf size={14} />
                    <span>Fresh Food (Cooked)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewItemCategory('PACKED')}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition ${
                      newItemCategory === 'PACKED'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Package size={14} />
                    <span>Packed Food (Stock)</span>
                  </button>
                </div>
              </div>

              {/* Item Name */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Item Name</label>
                <input
                  type="text"
                  placeholder="e.g. Masala Dosa, Paneer Rice, Veg Biryani"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Price and Type Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Price (₹)</label>
                  <input
                    type="number"
                    placeholder="40"
                    value={newItemPrice}
                    onChange={(e) => {
                      setNewItemPrice(e.target.value);
                      if (priceError) setPriceError(null);
                    }}
                    min="0.01"
                    step="any"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Food Type</label>
                  <select
                    value={newItemType}
                    onChange={(e) => setNewItemType(e.target.value as FoodType)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="VEG">🟢 Veg</option>
                    <option value="NON_VEG">🔴 Non-Veg</option>
                  </select>
                </div>
              </div>

              {/* Prep time or Quantity */}
              {newItemCategory === 'FRESH' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Kitchen Prep Duration (Minutes)</label>
                  <input
                    type="number"
                    placeholder="10"
                    value={newItemPrepTime}
                    onChange={(e) => setNewItemPrepTime(e.target.value)}
                    min="1"
                    max="60"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Available Quantity in Stock</label>
                  <input
                    type="number"
                    placeholder="20"
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(e.target.value)}
                    min="0"
                    max="1000"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {priceError && (
                <p className="text-xs text-rose-600 font-semibold">{priceError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddItemModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#1d68f2] hover:bg-blue-600 text-white shadow-md shadow-blue-500/25 transition"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  ) : isAnalyticsView ? (
    /* Dedicated View 3: Weekly Analytics */
    <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl p-5 sm:p-7 shadow-xl shadow-emerald-500/5 hover:shadow-emerald-500/10 transition-all duration-300">
      {/* Top ambient accent glow */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-emerald-500 to-teal-500 rounded-t-3xl" />
      <div className="absolute -top-20 -right-20 w-56 h-56 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Section */}
      <div className="flex flex-col items-center text-center mb-4 relative">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 via-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-2 ring-4 ring-emerald-50/70">
          <BarChart3 size={28} strokeWidth={2.2} />
        </div>
        <h1 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Weekly Analytics</h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-0.5 leading-snug">
          Kitchen velocity, customer order patterns, and sales volume over the past 7 days.
        </p>

        {/* Metric Badges Row */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200/70 shadow-xs">
            <Sparkles size={13} />
            {analytics.mostSold.reduce((acc, i) => acc + i.count, 0)} Items Sold
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-xs">
            {analytics.mostSold.length} Top Dishes Ranked
          </span>
        </div>
      </div>

      {/* Cards Grid (Exact Match to Screenshot 3) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Most Sold This Week */}
        <div className="bg-slate-50/70 rounded-2xl p-5 border border-slate-200 flex flex-col justify-between">
          <div>
            <h3 className="font-extrabold text-slate-800 mb-3 uppercase tracking-wider text-xs">
              Most Sold This Week
            </h3>
            {analyticsLoading ? (
              <div className="text-slate-400 text-xs py-6">Loading sales data...</div>
            ) : analytics.mostSold.length === 0 ? (
              <div className="text-slate-500 text-xs py-6">No sales data for this week.</div>
            ) : (
              <div className="space-y-3">
                {analytics.mostSold.map((item, idx) => {
                  const maxCount = analytics.mostSold[0]?.count || 1;
                  const percentage = Math.round((item.count / maxCount) * 100);
                  return (
                    <div key={item.name} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-700 truncate max-w-[160px]">
                          {idx + 1}. {item.name}
                        </span>
                        <span className="font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.2 rounded-full text-[10px]">
                          {item.count} sold
                        </span>
                      </div>
                      <div className="w-full bg-slate-200/80 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-600 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Great Job! Banner (Exact Match to Screenshot 3) */}
        <div className="bg-emerald-600 rounded-2xl p-6 text-white flex flex-col items-center justify-center text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-emerald-500/80 text-white flex items-center justify-center mb-3">
            <BarChart3 size={24} />
          </div>
          <h3 className="text-xl font-black mb-1">Great Job!</h3>
          <p className="text-emerald-100 text-xs max-w-xs">
            Keep up the good work managing orders.
          </p>
        </div>
      </div>
    </div>
  ) : isStaffView ? (
    /* Dedicated View 4: Kitchen Staff, Lunch Slots, & Penalties */
    <div className="col-span-12 space-y-6">
      {/* Manage Staff Section */}
      <div className="bg-white border border-slate-200/90 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col relative overflow-hidden">
    {/* Subtle decorative background ambient blur */}
    <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-emerald-100/40 via-teal-50/20 to-transparent rounded-full blur-3xl -z-0 pointer-events-none" />

    {/* Section Header */}
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 relative z-10">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
            <Users size={20} />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Staff Management</h2>
            <p className="text-xs text-slate-500 mt-0.5">Provision &amp; monitor counter staff credentials for this cafeteria</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 self-start sm:self-auto">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>{staffList.length} Active {staffList.length === 1 ? 'Operator' : 'Operators'}</span>
        </span>
      </div>
    </div>

    {/* Innovative Create Staff Form Card */}
    <form
      onSubmit={handleCreateStaff}
      className="mb-8 relative z-10 rounded-2xl bg-gradient-to-br from-slate-50/90 via-emerald-50/20 to-slate-50/70 border border-emerald-100/80 p-5 sm:p-6 shadow-xs hover:border-emerald-200 transition-all duration-300 backdrop-blur-xs"
    >
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
            <UserPlus size={16} />
          </span>
          <div>
            <h3 className="font-bold text-slate-800 text-sm">Provision New Staff Member</h3>
            <p className="text-[11px] text-slate-500">Instant access for kitchen &amp; delivery counter operators</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentCanteen?.name && (
            <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200 hidden sm:inline-block">
              Cafeteria: {currentCanteen.name}
            </span>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/60 px-2.5 py-0.5 rounded-full border border-emerald-200/50 hidden sm:inline-block">
            Role: Counter Staff
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {/* Full Name Input with Left Icon */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <User size={13} className="text-emerald-600" />
            <span>Full Name</span>
            <span className="text-emerald-600">*</span>
          </label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-emerald-600 transition-colors">
              <User size={16} />
            </div>
            <input
              type="text"
              required
              placeholder="e.g. Ramesh Kumar"
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none text-sm text-slate-800 placeholder:text-slate-400 shadow-2xs hover:border-slate-300 transition-all"
            />
          </div>
        </div>

        {/* Email Address Input with Left Icon */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Mail size={13} className="text-emerald-600" />
            <span>Email Address</span>
            <span className="text-emerald-600">*</span>
          </label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-emerald-600 transition-colors">
              <Mail size={16} />
            </div>
            <input
              type="email"
              required
              placeholder="staff@cafeteria.edu"
              value={newStaffEmail}
              onChange={(e) => setNewStaffEmail(e.target.value)}
              className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none text-sm text-slate-800 placeholder:text-slate-400 shadow-2xs hover:border-slate-300 transition-all"
            />
          </div>
        </div>

        {/* Password Input with Left Icon and Show/Hide toggle */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <KeyRound size={13} className="text-emerald-600" />
              <span>Password</span>
              <span className="text-emerald-600">*</span>
            </label>
            <span className="text-[10px] font-medium text-slate-400">Min. 6 chars</span>
          </div>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-emerald-600 transition-colors">
              <KeyRound size={16} />
            </div>
            <input
              type={showStaffPassword ? "text" : "password"}
              required
              minLength={6}
              placeholder="••••••••"
              value={newStaffPassword}
              onChange={(e) => setNewStaffPassword(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none text-sm text-slate-800 placeholder:text-slate-400 shadow-2xs hover:border-slate-300 transition-all font-mono tracking-wider"
            />
            <button
              type="button"
              onClick={() => setShowStaffPassword(!showStaffPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
              title={showStaffPassword ? "Hide password" : "Show password"}
            >
              {showStaffPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-3 border-t border-slate-200/60">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck size={14} className="text-emerald-600" />
          <span>Staff accounts receive verified dashboard access restricted to this canteen.</span>
        </div>
        <button
          type="submit"
          disabled={creatingStaff}
          className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white text-sm font-bold rounded-xl shadow-md shadow-emerald-700/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
        >
          {creatingStaff ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Provisioning...</span>
            </>
          ) : (
            <>
              <UserPlus size={16} />
              <span>Create Staff Account</span>
            </>
          )}
        </button>
      </div>
    </form>

    {/* Existing Staff Members List */}
    <div className="relative z-10">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-800 text-base">Active Staff Directory</h3>
          <span className="text-xs font-extrabold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {filteredStaffList.length}
          </span>
        </div>

        {/* Quick search input */}
        {staffList.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter staff by name or ID..."
              value={staffSearch}
              onChange={e => setStaffSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />
            {staffSearch && (
              <button
                onClick={() => setStaffSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {staffLoading ? (
        <div className="text-slate-500 text-xs py-10 text-center flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-600 rounded-full animate-spin" />
          <span>Loading staff directory...</span>
        </div>
      ) : filteredStaffList.length === 0 ? (
        <div className="bg-gradient-to-b from-slate-50 to-slate-50/50 border border-slate-200/80 rounded-2xl p-8 text-center flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <div className="font-bold text-slate-700 text-sm">
              {staffSearch ? 'No staff members match your filter' : 'No staff members registered yet'}
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              {staffSearch
                ? `No results found for "${staffSearch}". Try clearing your search filter.`
                : 'Use the form above to provision kitchen and counter staff accounts.'}
            </p>
          </div>
          {staffSearch && (
            <button
              onClick={() => setStaffSearch('')}
              className="text-xs font-bold text-emerald-600 hover:underline cursor-pointer"
            >
              Clear Search
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredStaffList.map((staff: any, idx: number) => {
            const shortId = staff.id_number || staff.id.split('-')[0].toUpperCase();
            const initials = (staff.name || 'S')
              .split(' ')
              .map((w: string) => w[0])
              .filter(Boolean)
              .slice(0, 2)
              .join('')
              .toUpperCase();
            const avatarGradients = [
              'from-emerald-500 to-teal-600',
              'from-teal-500 to-cyan-600',
              'from-blue-500 to-indigo-600',
              'from-indigo-500 to-purple-600',
              'from-emerald-600 to-emerald-800',
            ];
            const grad = avatarGradients[idx % avatarGradients.length];

            return (
              <div
                key={staff.id}
                className="p-4 rounded-2xl border border-slate-200/90 bg-white hover:border-emerald-300 hover:shadow-md transition-all duration-200 flex flex-col justify-between gap-3 group relative overflow-hidden"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${grad} text-white font-extrabold text-sm flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform`}>
                      {initials}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm leading-tight group-hover:text-emerald-700 transition-colors">
                        {staff.name || 'Unnamed Staff'}
                      </h4>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.2 rounded-full mt-1">
                        <ShieldCheck size={11} />
                        Counter Staff
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Active
                    </span>
                    <button
                      onClick={() => handleDeleteStaff(staff.id, staff.name)}
                      disabled={deletingStaffId === staff.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-all cursor-pointer disabled:opacity-50"
                      title="Delete staff member"
                    >
                      {deletingStaffId === staff.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-rose-400/30 border-t-rose-600 rounded-full animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">ID:</span>
                    <code className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                      {shortId}
                    </code>
                    <button
                      onClick={() => handleCopyId(staff.id)}
                      className="text-slate-400 hover:text-slate-700 transition-colors p-0.5 cursor-pointer"
                      title="Copy full UUID"
                    >
                      {copiedStaffId === staff.id ? (
                        <Check size={12} className="text-emerald-600" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>

                  <span className="text-slate-400">
                    Joined {new Date(staff.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  </div>

  {/* Lunch Pickup Time Slots Management */ }
  <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm flex flex-col">
    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-6 pb-4 border-b border-slate-100">
      <div>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <IconClock size={20} className="w-5 h-5 text-indigo-600 shrink-0" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Lunch Pickup Time Slots Management</h2>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Configure available lunch service hours, interval durations (5m, 10m, 15m, 20m, 30m), and toggle individual slot availability.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${slotConfig.isLunchEnabled
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-rose-50 text-rose-700 border border-rose-200'
          }`}>
          {slotConfig.isLunchEnabled ? 'Lunch Ordering Active' : 'Lunch Ordering Disabled'}
        </span>
      </div>
    </div>

    {slotConfigLoading ? (
      <div className="text-slate-500 text-sm py-8 text-center">Loading lunch slot configuration...</div>
    ) : (
      <div className="space-y-6">
        {/* Global Timing & Interval Settings */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 sm:p-5 bg-slate-50 border border-slate-200/80 rounded-2xl">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Service Start Time
            </label>
            <input
              type="time"
              value={slotConfig.serviceStartTime}
              onChange={e => setSlotConfig(prev => ({ ...prev, serviceStartTime: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Current: {formatPickupTime(slotConfig.serviceStartTime)}
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Service End Time
            </label>
            <input
              type="time"
              value={slotConfig.serviceEndTime}
              onChange={e => setSlotConfig(prev => ({ ...prev, serviceEndTime: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Current: {formatPickupTime(slotConfig.serviceEndTime)}
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Slot Interval Duration
            </label>
            <select
              value={slotConfig.slotDurationMinutes}
              onChange={e => setSlotConfig(prev => ({ ...prev, slotDurationMinutes: Number(e.target.value) }))}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value={5}>5 Minutes</option>
              <option value={10}>10 Minutes</option>
              <option value={15}>15 Minutes (Default)</option>
              <option value={20}>20 Minutes</option>
              <option value={30}>30 Minutes</option>
              <option value={45}>45 Minutes</option>
              <option value={60}>60 Minutes</option>
            </select>
            <span className="text-[11px] text-slate-400 mt-1 block">
              Generates slots across service hours
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Advance Notice Cutoff
            </label>
            <select
              value={slotConfig.minNoticeMinutes}
              onChange={e => setSlotConfig(prev => ({ ...prev, minNoticeMinutes: Number(e.target.value) }))}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value={0}>No notice required</option>
              <option value={15}>15 Minutes before slot</option>
              <option value={30}>30 Minutes before slot (Default)</option>
              <option value={45}>45 Minutes before slot</option>
              <option value={60}>60 Minutes before slot</option>
            </select>
            <span className="text-[11px] text-slate-400 mt-1 block">
              Buffer time for kitchen preparation
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Max Kitchen Capacity
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={slotConfig.maxConcurrentOrders ?? 15}
              onChange={e => setSlotConfig(prev => ({ ...prev, maxConcurrentOrders: Number(e.target.value) }))}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Max orders cooking per 15m window
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Default Item Prep Time
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={slotConfig.defaultPrepTimeMinutes ?? 10}
              onChange={e => setSlotConfig(prev => ({ ...prev, defaultPrepTimeMinutes: Number(e.target.value) }))}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Default cooking duration in minutes
            </span>
          </div>
        </div>

        {/* Service Toggle */}
        <div className="flex items-center justify-between p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableLunchToggle"
              checked={slotConfig.isLunchEnabled}
              onChange={e => setSlotConfig(prev => ({ ...prev, isLunchEnabled: e.target.checked }))}
              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
            />
            <label htmlFor="enableLunchToggle" className="text-sm font-bold text-slate-800 cursor-pointer">
              Enable Lunch Ordering Service
            </label>
          </div>
          <span className="text-xs text-slate-500">
            Turn off to temporarily stop accepting lunch pickup orders.
          </span>
        </div>

        {/* Generated Slots Grid & Individual Slot Toggles */}
        <div>
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                Active Slots ({generatedSlots.filter(s => s.enabled).length} of {generatedSlots.length} Enabled)
              </h3>
              <p className="text-xs text-slate-500">
                Click any slot badge to toggle availability on or off. Disabled slots will be hidden or grayed out for students.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleToggleAllSlots(true)}
                className="text-xs font-semibold px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                Enable All
              </button>
              <button
                type="button"
                onClick={() => handleToggleAllSlots(false)}
                className="text-xs font-semibold px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                Disable All
              </button>
            </div>
          </div>

          {generatedSlots.length === 0 ? (
            <div className="p-6 text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-2xl">
              No slots generated. Please check that End Time is later than Start Time and duration is valid.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {generatedSlots.map(slot => {
                const isDisabled = !slot.enabled;
                return (
                  <div
                    key={slot.value}
                    className={`p-3 rounded-xl border transition-all flex flex-col justify-between gap-2 ${isDisabled
                        ? 'bg-slate-100 border-slate-200 opacity-60'
                        : 'bg-white border-indigo-200/80 hover:border-indigo-400 shadow-xs'
                      }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-xs font-mono font-bold text-slate-800">
                          {slot.rangeLabel}
                        </span>
                        <div className="text-[11px] text-slate-500">
                          Pickup: {formatPickupTime(slot.value)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleSlot(slot.value)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider transition-colors ${isDisabled
                            ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                            : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          }`}
                      >
                        {isDisabled ? 'Disabled' : 'Enabled'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Save Button Row */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={handleResetSlotDefaults}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            Reset to Default (12:00 PM – 2:00 PM, 15m intervals)
          </button>

          <div className="flex items-center gap-3">
            {slotSaveSuccess && (
              <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                <IconCheckCircle size={14} className="w-3.5 h-3.5 text-emerald-600" />
                Configuration Saved!
              </span>
            )}
            <button
              type="button"
              onClick={handleSaveSlotConfig}
              disabled={savingSlotConfig || generatedSlots.length === 0}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-sm transition-all active:scale-95 flex items-center gap-2"
            >
              <IconCheckCircle size={16} className="w-4 h-4" />
              <span>{savingSlotConfig ? 'Saving Configuration...' : 'Save Slot Configuration'}</span>
            </button>
          </div>
        </div>
      </div>
    )}
  </div>

  {/* Student Penalties & Account Suspensions */ }
  <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm flex flex-col">
    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <IconAlertTriangle size={20} className="w-5 h-5 text-amber-600 shrink-0" />
          <span>Student No-Show Penalties &amp; Suspensions</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Students receive 1 strike per missed pickup. 2 strikes trigger an automatic 3-day account deactivation.
        </p>
      </div>
      <span className="text-xs font-semibold px-3 py-1 bg-slate-100 text-slate-600 rounded-full w-fit">
        {penalizedStudents.length} {penalizedStudents.length === 1 ? 'Student' : 'Students'} with records
      </span>
    </div>

    {penaltiesLoading ? (
      <div className="text-slate-500 text-xs py-4 text-center">Loading student penalty records...</div>
    ) : penalizedStudents.length === 0 ? (
      <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-5 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
        <IconSparkles size={16} className="w-4 h-4 text-emerald-500 shrink-0" />
        <span>All clean! No students currently have active strikes or suspensions.</span>
      </div>
    ) : (
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="py-2 px-3">Student</th>
              <th className="py-2 px-3">ID Number</th>
              <th className="py-2 px-3">Active Strikes</th>
              <th className="py-2 px-3">Account Status</th>
              <th className="py-2 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {penalizedStudents.map(student => {
              const isSuspended = !!(student.suspended_until && new Date(student.suspended_until) > new Date());
              return (
                <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 px-3 font-semibold text-slate-800">{student.name || 'Unnamed'}</td>
                  <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{student.id_number || 'N/A'}</td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${student.strike_count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                      {student.strike_count} / 2 Strikes
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    {isSuspended ? (
                      <div className="flex flex-col">
                        <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-red-100 text-red-700 w-fit flex items-center gap-1">
                          <IconBan size={11} className="w-3 h-3 text-red-600 shrink-0" />
                          <span>Suspended</span>
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          Until: {new Date(student.suspended_until).toLocaleDateString()}
                        </span>
                      </div>
                    ) : (
                      <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 w-fit">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => handleResetStudentStrikes(student.id, student.name || 'Student')}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg transition-colors active:scale-95"
                      title="Clear strikes and lift any active suspension"
                    >
                      Clear & Unsuspend
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
</div>
) : isReviewsView ? (
    /* Dedicated View 5: Student Feedback & Reviews */
    <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl p-5 sm:p-7 shadow-xl shadow-emerald-500/5 hover:shadow-emerald-500/10 transition-all duration-300">
      {/* Top ambient accent glow */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-emerald-500 to-teal-500 rounded-t-3xl" />
      <div className="absolute -top-20 -right-20 w-56 h-56 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Section */}
      <div className="flex flex-col items-center text-center mb-4 relative">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-500 via-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-2 ring-4 ring-emerald-50/70">
          <MessageSquare size={28} strokeWidth={2.2} />
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Student Feedback &amp; Reviews</h1>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full">
            {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
          </span>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-0.5 leading-snug">
          Read reviews from students and reply directly
        </p>

        {/* Metric Badges Row */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200/70 shadow-xs">
            <Star size={13} className="text-rose-500" />
            {reviews.length} Total Reviews
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-xs">
            {reviews.filter(r => r.admin_reply).length} Replied
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/70 shadow-xs">
            {reviews.filter(r => !r.admin_reply).length} Pending Reply
          </span>
        </div>
      </div>

      {/* Reviews List Container (Exact Match to Screenshot 5) */}
      <div className="max-h-[460px] overflow-y-auto pr-1">
        {reviewsLoading ? (
          <div className="text-slate-500 text-sm py-12 text-center">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="text-slate-400 text-sm py-12 text-center bg-slate-50/70 rounded-2xl border border-slate-100">
            No student reviews yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {reviews.map(review => (
              <div key={review.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col justify-between gap-2.5 hover:shadow-xs transition-shadow">
                <div>
                  <div className="flex justify-between items-start mb-1.5">
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">
                        {review.orders?.order_number ? `Order #${review.orders.order_number} - ` : ''}
                        {review.menu_items?.name || 'Unknown Item'}
                      </h3>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {review.orders?.id && <span className="font-mono">ID: {review.orders.id.split('-')[0].toUpperCase()} • </span>}
                        By {review.profiles?.name || 'Unknown'} ({review.profiles?.id_number || 'No ID'})
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <IconStar
                          key={i}
                          size={14}
                          className={`w-3.5 h-3.5 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`}
                          filled={i < review.rating}
                        />
                      ))}
                    </div>
                  </div>

                  {review.feedback_text && (
                    <div className="bg-white p-2.5 rounded-xl border border-slate-100 text-xs text-slate-700 italic my-1.5">
                      "{review.feedback_text}"
                    </div>
                  )}

                  <div className="text-[10px] text-slate-400">
                    Reviewed on: {new Date(review.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', hour12: true })}
                  </div>
                </div>

                {/* Admin Reply Section */}
                <div className="pt-2 border-t border-slate-200/80">
                  {review.admin_reply ? (
                    <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-100">
                      <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-0.5">Your Reply</div>
                      <p className="text-xs text-slate-800">{review.admin_reply}</p>
                    </div>
                  ) : replyingTo === review.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a reply..."
                        maxLength={500}
                        className="w-full text-xs bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        rows={2}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => { setReplyingTo(null); setReplyText(''); }}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700 transition cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleReplyToReview(review.id)}
                          disabled={submittingReply || !replyText.trim()}
                          className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition shadow-xs cursor-pointer"
                        >
                          {submittingReply ? 'Sending...' : 'Send Reply'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setReplyingTo(review.id)}
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 cursor-pointer transition"
                    >
                      <MessageSquare size={13} />
                      <span>Reply to feedback</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : (
    /* Executive CANTEEN OS Dashboard (Shown on main /canteen-admin) */
    <div className="h-full w-full flex flex-col justify-between gap-3 text-slate-900 select-none overflow-hidden">
      {/* Top Row: Welcome Banner (Left) + Date & Time Card (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch shrink-0">
        {/* Welcome Banner Card */}
        <div className="lg:col-span-9 relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#060b14] via-[#0d1624] to-[#141e30] text-white p-4 sm:p-5 shadow-lg border border-slate-800/80 flex flex-col justify-between min-h-[125px]">
          {/* Subtle dish background on the right */}
          <div className="absolute right-0 top-0 bottom-0 w-2/5 sm:w-1/2 pointer-events-none overflow-hidden hidden sm:block">
            <img
              src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80"
              alt="Fresh Dish"
              className="w-full h-full object-cover object-center opacity-85 mask-radial"
              style={{
                maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)',
                WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)'
              }}
            />
            {/* "Fresh Tasty Always" decorative text floating on dish */}
            <div className="absolute top-4 right-6 text-right drop-shadow-lg select-none hidden md:block">
              <span className="font-serif italic font-extrabold text-sm tracking-wide text-white drop-shadow-md block">
                Fresh
              </span>
              <span className="font-serif italic font-extrabold text-sm tracking-wide text-white drop-shadow-md block -mt-1">
                Tasty ·
              </span>
              <span className="font-serif italic font-extrabold text-sm tracking-wide text-white drop-shadow-md block -mt-1">
                Always
              </span>
            </div>
          </div>

          <div className="relative z-10 max-w-lg">
            <span className="text-xs sm:text-sm font-medium text-slate-300 block">
              Welcome back,
            </span>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {profile?.name || 'Madeshwar'}
              </h1>
              <span className="text-xl sm:text-2xl animate-bounce">👋</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-300 font-medium">
              Good evening! Here's what's happening in your canteen today.
            </p>

            {/* Feature Pills */}
            <div className="mt-2.5 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur-sm text-[10px] font-semibold text-slate-300">
              <Utensils size={12} className="text-blue-400" />
              <span>Fresh Food</span>
              <span className="text-slate-500">•</span>
              <span>Happy People</span>
              <span className="text-slate-500">•</span>
              <span>Better Days</span>
            </div>
          </div>
        </div>

        {/* Date & Time Widgets (Matched exactly to Staff Dashboard aesthetic) */}
        <div className="lg:col-span-3 flex flex-col justify-between gap-2.5">
          {/* Card 1: DATE */}
          <div className="relative overflow-hidden bg-gradient-to-r from-[#ffffff] via-[#f8fbff] to-[#f0f6ff] rounded-2xl sm:rounded-3xl border border-white p-3 sm:p-3.5 shadow-[0_8px_20px_rgba(180,205,240,0.35)] flex items-center justify-between min-h-[66px]">
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
                  {currentDashboardTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200/80 text-[10px] font-extrabold text-[#1d68f2] shadow-2xs">
                  <CalendarDays size={10} strokeWidth={2.6} />
                  <span>{currentDashboardTime.toLocaleDateString('en-US', { weekday: 'long' })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: TIME */}
          <div className="relative overflow-hidden bg-gradient-to-r from-[#ffffff] via-[#f9faff] to-[#eef4ff] rounded-2xl sm:rounded-3xl border border-white p-3 sm:p-3.5 shadow-[0_8px_20px_rgba(180,205,240,0.35)] flex items-center justify-between min-h-[66px]">
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
                  {currentDashboardTime.getHours() < 12 ? 'Morning' : currentDashboardTime.getHours() < 17 ? 'Afternoon' : 'Evening'}
                </div>
                <div className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/80 text-[10px] font-extrabold text-[#4f46e5] font-mono shadow-2xs">
                  <Clock size={10} strokeWidth={2.6} />
                  <span>{currentDashboardTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4 KPI Metric Cards - Exact Match to Design */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {/* Card 1: Today's Orders */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#f8faff] via-[#f1f6ff] to-[#e4efff] p-3.5 sm:p-4 rounded-2xl border border-[#d8e7ff] shadow-xs flex flex-col justify-between min-h-[110px]">
          {/* Blue mountain wave graphic from reference */}
          <div className="absolute right-0 bottom-0 pointer-events-none w-32 h-20 overflow-hidden">
            <svg viewBox="0 0 140 90" fill="none" className="w-full h-full opacity-80" preserveAspectRatio="none">
              <path
                d="M0 65 C 30 65, 50 35, 80 55 C 105 70, 115 15, 140 25 L 140 90 L 0 90 Z"
                fill="#cadffd"
              />
              <path
                d="M30 75 C 60 75, 80 50, 110 65 C 125 75, 130 45, 140 50 L 140 90 L 30 90 Z"
                fill="#b8d4fc"
                opacity="0.6"
              />
            </svg>
          </div>
          {/* Small flying paper plane / accent icon in top right */}
          <div className="absolute top-3.5 right-3.5 text-[#93c5fd] opacity-60">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
            </svg>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#1e69ff] to-[#0051e8] text-white flex items-center justify-center shadow-md shadow-blue-500/25 shrink-0">
                <ChefHat size={17} strokeWidth={2.2} />
              </div>
              <span className="text-xs font-extrabold text-[#1e293b] tracking-tight">Today's Orders</span>
            </div>
            <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight">
              {stats?.placed ?? todayOrdersCount}
            </div>
          </div>
          <div className="mt-1.5 text-[10px] font-bold text-[#16a34a] flex items-center gap-1.5 z-10">
            <span className="font-extrabold text-[11px]">↗ 100%</span>
            <span className="text-[#64748b] font-medium text-[10px]">vs yesterday</span>
          </div>
        </div>

        {/* Card 2: Revenue */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#f6fcf8] via-[#effaf2] to-[#e1f7e7] p-3.5 sm:p-4 rounded-2xl border border-[#cbf0d5] shadow-xs flex flex-col justify-between min-h-[110px]">
          {/* Green smooth rolling hill wave graphic */}
          <div className="absolute right-0 bottom-0 pointer-events-none w-32 h-20 overflow-hidden">
            <svg viewBox="0 0 140 90" fill="none" className="w-full h-full opacity-80" preserveAspectRatio="none">
              <path
                d="M0 75 C 35 75, 55 45, 85 60 C 110 72, 120 20, 140 22 L 140 90 L 0 90 Z"
                fill="#bbf0cb"
              />
              <path
                d="M40 80 C 70 80, 85 55, 115 65 C 128 72, 132 40, 140 42 L 140 90 L 40 90 Z"
                fill="#a3e9b7"
                opacity="0.6"
              />
            </svg>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#00aa63] to-[#00894f] text-white flex items-center justify-center shadow-md shadow-emerald-500/25 shrink-0">
                <span className="font-black text-lg leading-none">₹</span>
              </div>
              <span className="text-xs font-extrabold text-[#00874e] tracking-tight">Revenue</span>
            </div>
            <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight flex items-baseline gap-1">
              <span className="text-xl font-black">₹</span>
              <span>{(todayRevenue || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>
          <div className="mt-1.5 text-[10px] font-bold text-[#16a34a] flex items-center gap-1.5 z-10">
            <span className="font-extrabold text-[11px]">↗ 100%</span>
            <span className="text-[#64748b] font-medium text-[10px]">today collected</span>
          </div>
        </div>

        {/* Card 3: Avg. Prep Time */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#fffdf7] via-[#fff8eb] to-[#ffeed0] p-3.5 sm:p-4 rounded-2xl border border-[#fde4b8] shadow-xs flex flex-col justify-between min-h-[110px]">
          {/* Subtle amber watermarked clock dial illustration */}
          <div className="absolute -right-2 -bottom-2 pointer-events-none opacity-25 text-[#f59e0b]">
            <svg width="85" height="85" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="6">
              <circle cx="50" cy="50" r="42" />
              <path d="M50 22v30l20 10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#f29400] to-[#d97c00] text-white flex items-center justify-center shadow-md shadow-amber-500/25 shrink-0">
                <Clock size={17} strokeWidth={2.4} />
              </div>
              <span className="text-xs font-extrabold text-[#1e293b] tracking-tight">Avg. Prep Time</span>
            </div>
            <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight flex items-baseline gap-1">
              <span>{avgPrepTimeMinutes}</span>
              <span className="text-base font-bold text-[#334155]">min</span>
            </div>
          </div>
          <div className="mt-1.5 text-[10px] font-bold text-[#1e293b] flex items-center gap-1.5 z-10">
            <span className="text-[11px]">🎯</span>
            <span className="text-[#475569] font-medium text-[10px]">Standard kitchen target</span>
          </div>
        </div>

        {/* Card 4: Active Orders */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#faf7ff] via-[#f4edff] to-[#e8dafe] p-3.5 sm:p-4 rounded-2xl border border-[#e2d0fd] shadow-xs flex flex-col justify-between min-h-[110px]">
          {/* Subtle document page icon watermark in top/bottom right */}
          <div className="absolute right-2 bottom-2 pointer-events-none opacity-25 text-[#9333ea]">
            <svg width="45" height="55" viewBox="0 0 24 28" fill="currentColor">
              <path d="M4 0h10l6 6v22H4V0zm10 1.5V7h5.5L14 1.5zM6 11v2h12v-2H6zm0 4v2h12v-2H6zm0 4v2h8v-2H6z"/>
            </svg>
          </div>
          {/* Subtle purple cloud wave at the very bottom right */}
          <div className="absolute right-0 bottom-0 pointer-events-none w-24 h-12 overflow-hidden">
            <svg viewBox="0 0 100 50" fill="none" className="w-full h-full opacity-60">
              <path d="M0 35 C 30 20, 60 40, 100 15 L 100 50 L 0 50 Z" fill="#d8b4fe"/>
            </svg>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#8739f9] to-[#6d20e3] text-white flex items-center justify-center shadow-md shadow-purple-500/25 shrink-0">
                <ClipboardList size={17} strokeWidth={2.2} />
              </div>
              <span className="text-xs font-extrabold text-[#1e293b] tracking-tight">Active Orders</span>
            </div>
            <div className="text-2xl font-black text-[#0f172a] mt-2 tracking-tight">
              {liveActiveOrders.length}
            </div>
          </div>
          <div className="mt-1.5 text-[10px] font-medium text-[#64748b] z-10">
            {liveActiveOrders.length > 0 ? `${liveActiveOrders.length} active orders right now` : 'No active orders right now'}
          </div>
        </div>
      </div>

      {/* Main 2-Column Split: Left (Live Orders + Quick Actions + Order List) & Right (Popular Items + Promo Card) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch flex-1 min-h-0">
        {/* Left Column (8 cols on lg) */}
        <div className="lg:col-span-8 flex flex-col justify-between gap-3 min-h-0">
          {/* 1. Order List Table Card (Moved to the Top) */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-xs flex flex-col justify-between flex-1">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-blue-50 text-[#1d68f2] flex items-center justify-center">
                  <ClipboardList size={14} />
                </div>
                <h2 className="text-xs sm:text-sm font-extrabold text-slate-800">Order List</h2>
              </div>
              <Link
                to="/canteen-admin/orders"
                className="text-[11px] font-bold text-[#1d68f2] hover:underline flex items-center gap-1"
              >
                <span>View All</span>
                <span>→</span>
              </Link>
            </div>

            <div className="overflow-x-auto">
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
                  {allOrders.slice(0, 4).map((ord) => {
                    const custName = (ord.profiles as any)?.name || 'Guest User';
                    const itemsSummary = ord.order_items?.map((i: any) => `${i.menu_items?.name || 'Item'} (${i.quantity})`).join(', ') || '1 Item';
                    const amount = calculateOrderTotal(ord).totalAmount;
                    const timeStr = new Date(ord.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
                    
                    const isReadyOrDone = ord.status === 'READY' || ord.status === 'COLLECTED';
                    const isPrep = ord.status === 'PREPARING';

                    return (
                      <tr key={ord.id} className="hover:bg-slate-50/80 transition-colors">
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
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. Live Orders Card (Moved Down) */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-xs flex flex-col justify-between flex-1">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-xs sm:text-sm font-extrabold text-slate-800">Live Orders</h2>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                  {liveActiveOrders.length} active
                </span>
              </div>
              <Link
                to="/canteen-admin/orders"
                className="text-[11px] font-bold text-[#1d68f2] hover:underline flex items-center gap-1"
              >
                <span>View All Orders</span>
                <span>→</span>
              </Link>
            </div>

            {liveActiveOrders.length === 0 ? (
              /* Cloche Empty State matching screenshot */
              <div className="py-2.5 flex flex-col items-center justify-center text-center my-auto">
                <div className="w-12 h-12 rounded-full bg-blue-50/70 border border-blue-100/60 flex items-center justify-center text-blue-400 mb-1.5">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 18h16" />
                    <path d="M4 18a8 8 0 0 1 16 0" />
                    <path d="M12 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
                  </svg>
                </div>
                <div className="text-xs font-extrabold text-slate-800">
                  No live active orders right now.
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  New customer orders will show here in real time.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto my-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="pb-1.5">Order ID</th>
                      <th className="pb-1.5">Items</th>
                      <th className="pb-1.5">Time</th>
                      <th className="pb-1.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {liveActiveOrders.slice(0, 3).map((ord) => {
                      const summaryText = ord.order_items?.map((i: any) => `${i.quantity}x ${i.menu_items?.name || 'Item'}`).join(', ') || 'No items';
                      const timeStr = new Date(ord.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
                      const statusBadgeClass =
                        ord.status === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        ord.status === 'PREPARING' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        ord.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-slate-100 text-slate-700 border-slate-200';

                      return (
                        <tr key={ord.id} className="hover:bg-slate-50/70">
                          <td className="py-1.5 font-bold text-[#1d68f2] font-mono">#{ord.order_number}</td>
                          <td className="py-1.5 font-semibold text-slate-800 max-w-[200px] truncate" title={summaryText}>
                            {summaryText}
                          </td>
                          <td className="py-1.5 text-slate-500 font-medium">{timeStr}</td>
                          <td className="py-1.5 text-right">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${statusBadgeClass}`}>
                              {ord.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Quick Actions Footer */}
            <div className="mt-2 pt-2 border-t border-slate-100">
              <div className="text-[10px] font-bold text-slate-500 mb-1.5">
                Quick Actions
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/canteen-admin/menu"
                  className="px-3 py-1 bg-[#fff8f2] hover:bg-[#ffeedd] text-[#c25e1a] border border-[#fbd3b6] rounded-xl text-[11px] font-bold transition flex items-center gap-1.5 shadow-2xs"
                >
                  <Utensils size={12} className="text-[#c25e1a]" />
                  <span>Mark Sold Out</span>
                </Link>
                <Link
                  to="/canteen-admin/menu"
                  className="px-3 py-1 bg-[#f0f6ff] hover:bg-[#e0edff] text-[#1d68f2] border border-[#bfdbfe] rounded-xl text-[11px] font-bold transition flex items-center gap-1.5 shadow-2xs"
                >
                  <Clock size={12} className="text-[#1d68f2]" />
                  <span>Toggle Slot</span>
                </Link>
                <Link
                  to="/canteen-admin/analytics"
                  className="px-3 py-1 bg-[#f0fdf4] hover:bg-[#dcfce7] text-emerald-700 border border-[#bbf7d0] rounded-xl text-[11px] font-bold transition flex items-center gap-1.5 shadow-2xs"
                >
                  <BarChart3 size={12} className="text-emerald-700" />
                  <span>View Reports</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (4 cols on lg): Popular Items + Promo Card */}
        <div className="lg:col-span-4 flex flex-col justify-between gap-3 min-h-0">
          {/* Popular Items Card */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-xs flex flex-col justify-between flex-1">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-orange-500 text-sm">🔥</span>
                <h2 className="text-xs sm:text-sm font-extrabold text-slate-800">Popular Items</h2>
              </div>
              <Link
                to="/canteen-admin/menu"
                className="text-[11px] font-bold text-[#1d68f2] hover:underline flex items-center gap-1"
              >
                <span>View All</span>
                <span>→</span>
              </Link>
            </div>

            {/* List of items matching image with thumbnails & Available badges */}
            <div className="space-y-2">
              {(menuItems.slice(0, 4).length > 0 ? menuItems.slice(0, 4) : [
                { id: '1', name: 'Masala Dosa', price: 40, is_sold_out: false },
                { id: '2', name: 'Idli (2 pcs)', price: 20, is_sold_out: false },
                { id: '3', name: 'Plain Rice', price: 15, is_sold_out: false },
                { id: '4', name: 'Tea', price: 10, is_sold_out: false }
              ]).map((item, idx) => {
                const foodPics = [
                  'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=120&q=80',
                  'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=120&q=80',
                  'https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=120&q=80',
                  'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=120&q=80'
                ];
                const picUrl = (item as any).image_url || foodPics[idx % foodPics.length];

                return (
                  <div key={item.id} className="flex items-center justify-between p-1.5 rounded-xl hover:bg-slate-50 transition">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={picUrl}
                        alt={item.name}
                        className="w-9 h-9 rounded-xl object-cover shrink-0 shadow-2xs border border-slate-100"
                        onError={(e: any) => {
                          e.target.src = foodPics[idx % foodPics.length];
                        }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-slate-800 truncate">
                          {item.name}
                        </div>
                        <div className="text-[11px] font-bold text-slate-500">
                          ₹ {item.price}
                        </div>
                      </div>
                    </div>

                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 shrink-0 ${
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
                );
              })}
            </div>
          </div>

          {/* Delicious Food Promo Card (Bottom Right) */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0d131f] via-[#111a2c] to-[#18233c] text-white p-3.5 shadow-md border border-slate-800 shrink-0">
            {/* Food Platter Right Half */}
            <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none overflow-hidden">
              <img
                src="https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?auto=format&fit=crop&w=500&q=80"
                alt="Delicious Food"
                className="w-full h-full object-cover object-center opacity-85"
                style={{
                  maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%)',
                  WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%)'
                }}
              />
            </div>

            <div className="relative z-10 max-w-[55%]">
              <h3 className="font-serif italic font-extrabold text-base text-white leading-tight">
                Delicious<br />Food
              </h3>
              <p className="text-[10px] text-slate-300 font-medium mt-0.5 leading-tight">
                Made with care<br />for you 💕
              </p>
              <Link
                to="/canteen-admin/menu"
                className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold shadow-md shadow-emerald-500/25 transition active:scale-95"
              >
                <span>Good Food</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )}
</div>
);
}
