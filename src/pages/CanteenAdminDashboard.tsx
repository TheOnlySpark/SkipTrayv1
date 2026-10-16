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
  Plus
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

  const currentCanteenId = profile?.canteen_id;
  const currentTenantId = profile?.tenant_id ?? tenantId ?? null;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ placed: 0, collected: 0, rejected: 0 });

  // Menu Search & Filter State
  const [menuSearch, setMenuSearch] = useState('');
  const [menuTypeFilter, setMenuTypeFilter] = useState<'ALL' | 'VEG' | 'NON_VEG' | 'PACKED' | 'AVAILABLE' | 'SOLD_OUT'>('ALL');
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
            id, order_number, status, created_at, pickup_time, total_tax_amount,
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
          id, order_number, status, created_at, pickup_time, total_tax_amount,
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
          *,
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
          *,
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
      const isPacked = (item as any).category === 'Packed Food' || (item as any).category === 'PACKED' || getItemCategory(item) === 'Packed Food' || (item.name || '').toLowerCase().includes('packed');
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
    queryKey: ['canteenPenalizedStudents'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .or('strike_count.gt.0,suspended_until.not.is.null')
        .order('name');
      return (data as any[]) || [];
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

  const saveItemMetadata = (itemId: string, meta: { category?: string; prep_time_minutes?: number; stock_quantity?: number | null }) => {
    try {
      const key = `canteen_menu_meta_${currentCanteenId}`;
      const existing = localStorage.getItem(key);
      const map = existing ? JSON.parse(existing) : {};
      map[itemId] = { ...(map[itemId] || {}), ...meta };
      localStorage.setItem(key, JSON.stringify(map));

      const globalMapKey = 'skiptray_menu_meta_global';
      const globalExisting = localStorage.getItem(globalMapKey);
      const globalMap = globalExisting ? JSON.parse(globalExisting) : {};
      globalMap[itemId] = { ...(globalMap[itemId] || {}), ...meta };
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

  // Lunch Pickup Time Slots Management State
  const [slotConfig, setSlotConfig] = useState<LunchSlotConfig>(DEFAULT_LUNCH_SLOT_CONFIG);
  const [slotConfigLoading, setSlotConfigLoading] = useState(true);
  const [savingSlotConfig, setSavingSlotConfig] = useState(false);
  const [slotSaveSuccess, setSlotSaveSuccess] = useState(false);

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
          const meta = metaMap[item.id] || {};
          const isPacked = meta.category === 'Packed Food' || (item as any).category === 'Packed Food' || getItemCategory(item) === 'Packed Food';
          return {
            ...item,
            category: (item as any).category || meta.category || (isPacked ? 'Packed Food' : 'Meals'),
            prep_time_minutes: (item as any).prep_time_minutes ?? meta.prep_time_minutes ?? (isPacked ? 0 : 10),
            stock_quantity: (item as any).stock_quantity ?? meta.stock_quantity ?? (isPacked ? 20 : null),
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
      });

      setMenuItems([enhancedItem as any, ...menuItems]);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemPrepTime('10');
      setNewItemQuantity('20');
      setPriceError(null);
      showAlert({
        title: 'Item Added',
        message: `Successfully added ${newItemName.trim()} (${isPacked ? `Packed Food • Stock: ${parsedStock} pcs` : `Fresh Food • Prep: ${parsedPrepTime}m`}).`,
        type: 'success'
      });
    }
  };

  const handleToggleSoldOut = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.rpc('toggle_sold_out', { item_id: id, new_status: !currentStatus });
    if (!error) {
      setMenuItems(menuItems.map(item => item.id === id ? { ...item, is_sold_out: !currentStatus } : item));
    } else {
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
    <div className={`w-full ${isOrdersView || !isDedicatedView ? 'max-w-5xl' : 'max-w-4xl'} mx-auto grid grid-cols-1 gap-5`}>
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
            { key: 'REJECTED', label: 'Cancelled', count: statusCounts.REJECTED || 0 },
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
                            {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                            {order.status === 'REJECTED' ? 'CANCELLED' : order.status}
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
                          {order.status === 'REJECTED' ? 'CANCELLED' : order.status}
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
                      <span>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
    /* Dedicated View 2: Manage Menu */
    <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col">
        <div className="flex justify-between items-center mb-5 shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-800">Manage Menu</h2>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              {filteredMenuItems.length} {filteredMenuItems.length === 1 ? 'item' : 'items'}
            </span>
          </div>
        </div>
        <form onSubmit={handleAddItem} className="flex flex-col gap-3.5 mb-5 bg-slate-50 p-4.5 rounded-2xl border border-slate-200/80 shadow-xs shrink-0">
          {/* Category Selector: Fresh Food vs Packed Food */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Category:</span>
            <div className="inline-flex p-1 bg-white border border-slate-200 rounded-xl gap-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setNewItemCategory('FRESH')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                  newItemCategory === 'FRESH'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span>🍳 Fresh Food</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${newItemCategory === 'FRESH' ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-100 text-slate-500'}`}>
                  Prep Time
                </span>
              </button>
              <button
                type="button"
                onClick={() => setNewItemCategory('PACKED')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                  newItemCategory === 'PACKED'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span>📦 Packed Food</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${newItemCategory === 'PACKED' ? 'bg-purple-700 text-purple-100' : 'bg-slate-100 text-slate-500'}`}>
                  Quantity
                </span>
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder={newItemCategory === 'FRESH' ? 'Fresh Food Name (e.g., Sambar Rice, KFC Chicken, Paneer Dosa, Meals)' : 'Packed Food Name (e.g., Lays Classic, Oreo Biscuits, Amul Lassi, Packed Chips)'}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            maxLength={100}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-slate-800 placeholder:text-slate-400 font-medium"
          />

          <div className="flex flex-col gap-1">
            <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
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
                className={`w-28 px-3.5 py-2.5 bg-white border ${priceError ? 'border-rose-400 ring-1 ring-rose-400' : 'border-slate-200'} rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold text-slate-800`}
              />

              {/* Conditional Input: Fresh Food has Preparation Time; Packed Food has Select Quantity */}
              {newItemCategory === 'FRESH' ? (
                <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">⏱️ Prep:</span>
                  <input
                    type="number"
                    placeholder="10"
                    title="Estimated kitchen preparation duration in minutes"
                    value={newItemPrepTime}
                    onChange={(e) => setNewItemPrepTime(e.target.value)}
                    min="1"
                    max="60"
                    className="w-12 px-1 py-1 text-sm font-bold text-slate-800 text-center border-none outline-none focus:ring-0"
                  />
                  <span className="text-[11px] font-semibold text-slate-400">mins</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5">
                  <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider shrink-0">📦 Qty:</span>
                  <input
                    type="number"
                    placeholder="20"
                    title="Available stock quantity in pieces"
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(e.target.value)}
                    min="0"
                    max="1000"
                    className="w-14 px-1 py-1 text-sm font-bold text-slate-800 text-center border-none outline-none focus:ring-0"
                  />
                  <select
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(e.target.value)}
                    className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-1 cursor-pointer"
                    title="Quick preset quantity options"
                  >
                    <option value="5">5 pcs</option>
                    <option value="10">10 pcs</option>
                    <option value="15">15 pcs</option>
                    <option value="20">20 pcs</option>
                    <option value="25">25 pcs</option>
                    <option value="50">50 pcs</option>
                    <option value="100">100 pcs</option>
                  </select>
                </div>
              )}

              <select
                value={newItemType}
                onChange={(e) => setNewItemType(e.target.value as FoodType)}
                className="w-28 px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold text-slate-800"
              >
                <option value="VEG">🟢 Veg</option>
                <option value="NON_VEG">🔴 Non-Veg</option>
              </select>

              <button
                type="submit"
                className={`px-5 py-2.5 text-white rounded-xl text-sm font-bold active:scale-95 transition-all shrink-0 cursor-pointer shadow-xs ${
                  newItemCategory === 'FRESH'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                + Add {newItemCategory === 'FRESH' ? 'Fresh Food' : 'Packed Item'}
              </button>
            </div>
            {priceError && (
              <p className="text-xs text-rose-600 font-semibold mt-0.5">{priceError}</p>
            )}
          </div>
        </form>

        {/* Search & Filter Toolbar */}
        <div className="space-y-2.5 mb-4 shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by item name, price, or category..."
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 placeholder:text-slate-400"
            />
            {menuSearch && (
              <button
                onClick={() => setMenuSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
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
                  onClick={() => setMenuTypeFilter(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all border inline-flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <IconComp size={13} className={isSelected ? 'text-white' : iconColor} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Menu Items List Container */}
        <div className="flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="text-slate-500 text-sm py-12 text-center">Loading menu...</div>
        ) : filteredMenuItems.length === 0 ? (
          <div className="col-span-full text-slate-400 text-sm text-center py-12 bg-slate-50/70 rounded-2xl border border-slate-100">
            {menuSearch || menuTypeFilter !== 'ALL'
              ? 'No menu items match your search or filter.'
              : 'No menu items for this location yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {filteredMenuItems.map(item => {
              const isPacked = (item as any).category === 'Packed Food' || item.name.toLowerCase().includes('packed') || getItemCategory(item) === 'Packed Food';
              const stock = (item as any).stock_quantity ?? (isPacked ? 20 : null);
              const prepMinutes = (item as any).prep_time_minutes ?? (isPacked ? 0 : 10);

              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-2 shadow-xs ${item.is_sold_out
                      ? 'bg-slate-50/60 border-slate-200 opacity-70'
                      : 'bg-white border-slate-200/90 hover:border-emerald-300'
                    }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="font-extrabold text-slate-900 text-sm truncate">{item.name}</h4>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-black border ${item.veg_non_veg === 'VEG'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                          {item.veg_non_veg === 'VEG' ? 'VEG' : 'NON-VEG'}
                        </span>
                        {isPacked ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-black bg-purple-50 text-purple-700 border border-purple-200">
                            📦 PACKED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-black bg-amber-50 text-amber-700 border border-amber-200">
                            🍳 FRESH • {prepMinutes}m prep
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="font-black text-emerald-700 text-sm">
                          ₹{Number(item.price).toFixed(2)}
                        </span>
                        {isPacked && (
                          <div className="inline-flex items-center gap-1.5 bg-purple-50/70 border border-purple-200/80 px-2 py-0.5 rounded-lg">
                            <span className="text-[10px] font-bold text-purple-700">Stock:</span>
                            <button
                              type="button"
                              onClick={() => handleUpdateStock(item.id, Math.max(0, (stock ?? 0) - 1))}
                              disabled={(stock ?? 0) <= 0}
                              className="w-5 h-5 flex items-center justify-center rounded bg-white border border-purple-200 hover:bg-purple-100 text-xs font-black text-purple-900 disabled:opacity-30 cursor-pointer shadow-2xs"
                              title="Decrease stock by 1"
                            >
                              −
                            </button>
                            <span className={`text-xs font-black min-w-[20px] text-center ${(stock ?? 0) === 0 ? 'text-rose-600 font-extrabold' : 'text-purple-900'}`}>
                              {stock ?? 0}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateStock(item.id, (stock ?? 0) + 1)}
                              className="w-5 h-5 flex items-center justify-center rounded bg-white border border-purple-200 hover:bg-purple-100 text-xs font-black text-purple-900 cursor-pointer shadow-2xs"
                              title="Increase stock by 1"
                            >
                              +
                            </button>
                            <span className="text-[10px] text-purple-600 font-semibold">pcs</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteMenuItem(item.id, item.name)}
                      className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                      title="Delete item"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${item.is_sold_out ? 'text-rose-600' : 'text-emerald-600'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${item.is_sold_out ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      <span>{item.is_sold_out ? 'Sold Out' : 'Available'}</span>
                    </span>
                    <button
                      onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border ${item.is_sold_out
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                    >
                      {item.is_sold_out ? 'Mark Available' : 'Mark Sold Out'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/60 px-2.5 py-0.5 rounded-full border border-emerald-200/50 hidden sm:inline-block">
          Role: Counter Staff
        </span>
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
                    Reviewed on: {new Date(review.created_at).toLocaleString()}
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
    /* Executive Canteen Operations Hub (Shown on main /canteen-admin) */
    <>
      {/* Welcome Banner */}
      <div className="bg-emerald-600 rounded-[2rem] p-6 sm:p-8 text-white shadow-sm relative overflow-hidden">
        <span className="px-3 py-1 bg-emerald-500 text-xs font-bold uppercase tracking-wider rounded-full border border-emerald-400">
          Canteen Admin
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold mt-4 leading-tight">Welcome, {profile?.name || 'Admin'}</h1>
        <p className="mt-2 text-emerald-100 max-w-2xl text-xs sm:text-sm leading-relaxed">
          Executive canteen operations hub. Select any module from the navigation sidebar or quick cards below to manage orders, menu items, kitchen staff, and customer reviews.
        </p>
      </div>

      {/* Today's Summary */}
      <div className="bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-7 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Today's Summary</h2>
          <span className="text-xs font-semibold text-slate-500">Live Shifts</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <div className="p-5 bg-blue-50/80 border border-blue-100/80 rounded-2xl flex flex-col items-center">
            <span className="text-3xl font-black text-blue-700">{stats.placed}</span>
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wide mt-1">Total Orders</span>
          </div>
          <div className="p-5 bg-emerald-50/80 border border-emerald-100/80 rounded-2xl flex flex-col items-center">
            <span className="text-3xl font-black text-emerald-700">{stats.collected}</span>
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-wide mt-1">Collected</span>
          </div>
          <div className="p-5 bg-rose-50/80 border border-rose-100/80 rounded-2xl flex flex-col items-center">
            <span className="text-3xl font-black text-rose-700">{stats.rejected}</span>
            <span className="text-xs font-bold text-rose-600 uppercase tracking-wide mt-1">Rejected / Cancelled</span>
          </div>
        </div>
      </div>

      {/* 5 Interactive Hub Cards (Matching University Admin Pattern) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Card 1: Order List */}
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center mb-4 border border-blue-200/60">
              <ClipboardList size={24} />
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-extrabold text-slate-800 text-lg">Order List</h3>
              <span className="text-2xl font-black text-slate-900">{allOrders.length}</span>
            </div>
            <p className="text-slate-500 text-xs mb-4">
              Real-time order statuses, pickup time verification, and fulfillment stages.
            </p>
          </div>
          <Link
            to="/canteen-admin/orders"
            className="w-full py-2.5 px-4 bg-slate-50 hover:bg-emerald-50 text-emerald-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-emerald-200 transition"
          >
            <span>Inspect Orders</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Card 2: Manage Menu */}
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4 border border-amber-200/60">
              <Utensils size={24} />
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-extrabold text-slate-800 text-lg">Manage Menu</h3>
              <span className="text-2xl font-black text-slate-900">{menuItems.length}</span>
            </div>
            <p className="text-slate-500 text-xs mb-4">
              {menuItems.filter(i => !i.is_sold_out).length} active items currently in stock and available for ordering.
            </p>
          </div>
          <Link
            to="/canteen-admin/menu"
            className="w-full py-2.5 px-4 bg-slate-50 hover:bg-emerald-50 text-emerald-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-emerald-200 transition"
          >
            <span>Configure Menu</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Card 3: Weekly Analytics */}
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center mb-4 border border-purple-200/60">
              <BarChart3 size={24} />
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-extrabold text-slate-800 text-lg">Weekly Analytics</h3>
              <span className="text-2xl font-black text-slate-900">
                {analytics.mostSold.reduce((acc, i) => acc + i.count, 0)}
              </span>
            </div>
            <p className="text-slate-500 text-xs mb-4">
              {analytics.mostSold.length > 0
                ? `Top seller: "${analytics.mostSold[0]?.name}" (${analytics.mostSold[0]?.count} sold)`
                : 'Track kitchen demand velocity and sales performance.'}
            </p>
          </div>
          <Link
            to="/canteen-admin/analytics"
            className="w-full py-2.5 px-4 bg-slate-50 hover:bg-emerald-50 text-emerald-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-emerald-200 transition"
          >
            <span>View Analytics</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Card 4: Manage Staff & Penalties */}
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center mb-4 border border-indigo-200/60">
              <Users size={24} />
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-extrabold text-slate-800 text-lg">Staff &amp; Penalties</h3>
              <span className="text-2xl font-black text-slate-900">{staffList.length}</span>
            </div>
            <p className="text-slate-500 text-xs mb-4">
              {penalizedStudents.length > 0
                ? `${penalizedStudents.length} student(s) currently flagged with no-show strikes.`
                : 'Kitchen staff credentials and student no-show rules.'}
            </p>
          </div>
          <Link
            to="/canteen-admin/staff"
            className="w-full py-2.5 px-4 bg-slate-50 hover:bg-emerald-50 text-emerald-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-emerald-200 transition"
          >
            <span>Staff & Strike Controls</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Card 5: Student Feedback & Reviews */}
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition sm:col-span-2">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center mb-4 border border-rose-200/60">
              <MessageSquare size={24} />
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-extrabold text-slate-800 text-lg">Student Feedback &amp; Reviews</h3>
              <span className="text-2xl font-black text-slate-900">{reviews.length}</span>
            </div>
            <p className="text-slate-500 text-xs mb-4">
              Read student dish reviews, quality feedback, and publish kitchen responses.
            </p>
          </div>
          <Link
            to="/canteen-admin/reviews"
            className="w-full py-2.5 px-4 bg-slate-50 hover:bg-emerald-50 text-emerald-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-emerald-200 transition"
          >
            <span>Inspect Feedback</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </>
  )}
</div>
);
}
