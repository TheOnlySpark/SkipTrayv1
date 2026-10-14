import React, { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "react-router-dom";
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPickupTime } from './StudentDashboard';
import {
  IconAlertTriangle,
  IconBan,
  IconStar,
  IconSparkles
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
  Utensils,
  ClipboardList,
  ArrowRight,
  BarChart3,
  Users,
  MessageSquare,
  ShieldCheck,
  Plus,
  Trash2,
  TrendingUp,
  Sparkles,
  Star,
  KeyRound,
  Mail,
  Store,
  Coffee,
  CheckCircle2,
  XCircle,
  Tag,
  Leaf,
  Flame,
  ListFilter
} from 'lucide-react';
import { isValidEmail, formatErrorMessage } from '../utils/validation';

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
  const [orderFilter, setOrderFilter] = useState<'TODAY' | 'WEEK' | 'MONTH'>('TODAY');

  // Order List Filters, Pagination & View
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'REJECTED'>('ALL');
  const [orderViewMode, setOrderViewMode] = useState<'TABLE' | 'CARDS'>('TABLE');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());

  // Reset pagination on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [orderSearch, orderStatusFilter, orderFilter]);

  const toggleExpandOrder = (orderId: string) => {
    setExpandedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const { data: allOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['canteenOrders', orderFilter, currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      let startDate = new Date();
      if (orderFilter === 'TODAY') {
        startDate.setHours(0, 0, 0, 0);
      } else if (orderFilter === 'WEEK') {
        startDate.setDate(startDate.getDate() - 7);
      } else if (orderFilter === 'MONTH') {
        startDate.setMonth(startDate.getMonth() - 1);
      }

      const { data } = await supabase
        .from('orders')
        .select(`
          *,
          profiles (name, id_number),
          order_items (
            id, quantity,
            menu_items (name, price)
          )
        `)
        .eq('canteen_id', currentCanteenId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      return (data as any[]) || [];
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

  // Filtered orders
  const filteredAdminOrders = useMemo(() => {
    return allOrders.filter(order => {
      if (orderStatusFilter !== 'ALL' && order.status !== orderStatusFilter) {
        return false;
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
        if (!matchNum && !matchName && !matchId && !matchShortId && !matchItems) {
          return false;
        }
      }
      return true;
    });
  }, [allOrders, orderStatusFilter, orderSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredAdminOrders.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAdminOrders.slice(start, start + pageSize);
  }, [filteredAdminOrders, currentPage, pageSize]);

  // Filtered menu items based on menuSearch and menuTypeFilter
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter(item => {
      // Type/Status filter
      if (menuTypeFilter === 'VEG' && item.veg_non_veg !== 'VEG') return false;
      if (menuTypeFilter === 'NON_VEG' && item.veg_non_veg !== 'NON_VEG') return false;
      if (menuTypeFilter === 'PACKED' && !item.name.toLowerCase().includes('packed')) return false;
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

  const { data: canteenStaff = [], isLoading: staffLoading } = useQuery({
    queryKey: ['canteenStaff', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('canteen_id', currentCanteenId)
        .eq('role', 'STAFF')
        .order('name');
      if (error) return [];
      return data || [];
    }
  });

  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);

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
  const [newItemQuantity, setNewItemQuantity] = useState('');

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

    return () => {
      supabase.removeChannel(orderSub);
      supabase.removeChannel(menuSub);
      supabase.removeChannel(reviewSub);
    };
  }, [currentCanteenId, orderFilter]);

  const fetchMenu = async () => {
    if (!currentCanteenId) return;
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('canteen_id', currentCanteenId)
      .order('name');
    
    if (data) setMenuItems(data);
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
    if (!currentCanteenId || !currentTenantId) {
      showAlert({ title: 'Error', message: 'No canteen assigned to your account.', type: 'error' });
      return;
    }

    const priceNum = parseFloat(newItemPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      showAlert({ title: 'Invalid Price', message: 'Please enter a valid price greater than zero.', type: 'warning' });
      return;
    }

    const trimmedName = newItemName.trim();
    if (!trimmedName) {
      showAlert({ title: 'Missing Name', message: 'Please enter an item name.', type: 'warning' });
      return;
    }

    let finalName = trimmedName;
    if (newItemCategory === 'PACKED' && !finalName.toLowerCase().includes('packed')) {
      finalName = `${finalName} (Packed)`;
    }

    const initialQuantity = newItemCategory === 'PACKED' && newItemQuantity ? parseInt(newItemQuantity, 10) : 0;

    const { data, error } = await supabase.from('menu_items').insert({
      name: finalName,
      price: priceNum,
      veg_non_veg: newItemType,
      tenant_id: currentTenantId,
      canteen_id: currentCanteenId
    }).select().single();

    if (error) {
      showAlert({ title: 'Error', message: `Failed to add item: ${formatErrorMessage(error)}`, type: 'error' });
      return;
    }

    if (data) {
      setMenuItems([data, ...menuItems]);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemCategory('FRESH');
      setNewItemQuantity('');
      showAlert({ title: 'Item Added', message: `"${finalName}" was successfully added to the menu.`, type: 'success' });
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

    const { error } = await supabase
      .from('menu_items')
      .delete()
      .eq('id', id);

    if (error) {
      showAlert({ title: 'Delete Failed', message: `Could not delete "${name}": ${error.message}`, type: 'error' });
    } else {
      setMenuItems(prev => prev.filter(item => item.id !== id));
      showAlert({ title: 'Item Deleted', message: `"${name}" was removed from the menu.`, type: 'success' });
    }
  };

  if (!currentCanteenId) {
    return <div className="text-center p-8">You are not assigned to any canteen. Please contact your University Admin.</div>;
  }

  return (
    <div className={`w-full ${isOrdersView || !isDedicatedView ? 'max-w-4xl' : 'max-w-3xl'} mx-auto grid grid-cols-1 gap-4`}>
      {isOrdersView ? (
        /* Dedicated View 1: Order List */
        <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl p-5 sm:p-7 shadow-xl shadow-emerald-500/5 hover:shadow-emerald-500/10 transition-all duration-300">
          {/* Top ambient accent glow */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-emerald-500 to-teal-500 rounded-t-3xl" />
          <div className="absolute -top-20 -right-20 w-56 h-56 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header Section */}
          <div className="flex flex-col items-center text-center mb-4 relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 via-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-2 ring-4 ring-emerald-50/70">
              <ClipboardList size={28} strokeWidth={2.2} />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Order List</h1>
              <span className="text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                {filteredAdminOrders.length} {filteredAdminOrders.length === 1 ? 'order' : 'orders'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-0.5 leading-snug">
              Filter, search, and inspect orders across time ranges
            </p>

            {/* Metric Badges Row */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/70 shadow-xs">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                {statusCounts.ALL || 0} Total Orders
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-xs">
                {statusCounts.COLLECTED || 0} Collected
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/70 shadow-xs">
                {(statusCounts.PLACED || 0) + (statusCounts.ACCEPTED || 0) + (statusCounts.PREPARING || 0) + (statusCounts.READY || 0)} In Progress
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/70 shadow-xs">
                {statusCounts.REJECTED || 0} Rejected
              </span>
            </div>
          </div>

          {/* Date range picker & Toolbar */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
            <div className="flex items-center gap-1.5">
              {(['TODAY', 'WEEK', 'MONTH'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setOrderFilter(filter)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                    orderFilter === filter
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {filter === 'TODAY' ? "Today" : filter === 'WEEK' ? "Past Week" : "Past Month"}
                </button>
              ))}
            </div>

            {/* View Mode Switcher */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-end sm:self-auto shrink-0">
              <button
                onClick={() => setOrderViewMode('TABLE')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  orderViewMode === 'TABLE'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutList size={14} />
                <span>Table</span>
              </button>
              <button
                onClick={() => setOrderViewMode('CARDS')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  orderViewMode === 'CARDS'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutGrid size={14} />
                <span>Cards</span>
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative mb-3.5">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by Order #, Student Name, Student ID, or Item..."
              value={orderSearch}
              onChange={e => setOrderSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 placeholder:text-slate-400 shadow-xs"
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

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 mb-3.5 scrollbar-thin">
            {[
              { key: 'ALL', label: 'All', count: statusCounts.ALL || 0 },
              { key: 'PLACED', label: 'Placed', count: statusCounts.PLACED || 0 },
              { key: 'ACCEPTED', label: 'Accepted', count: statusCounts.ACCEPTED || 0 },
              { key: 'PREPARING', label: 'Preparing', count: statusCounts.PREPARING || 0 },
              { key: 'READY', label: 'Ready', count: statusCounts.READY || 0 },
              { key: 'COLLECTED', label: 'Collected', count: statusCounts.COLLECTED || 0 },
              { key: 'REJECTED', label: 'Rejected', count: statusCounts.REJECTED || 0 },
            ].map(tab => {
              const isSelected = orderStatusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setOrderStatusFilter(tab.key as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all border flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : tab.count > 0
                        ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                    isSelected
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Orders Content Area */}
          <div className="max-h-[380px] overflow-y-auto pr-1">
            {ordersLoading ? (
              <div className="text-slate-500 text-sm py-16 text-center">Loading orders...</div>
            ) : filteredAdminOrders.length === 0 ? (
              <div className="text-slate-500 text-sm py-12 text-center bg-slate-50/70 rounded-2xl border border-slate-100 space-y-2">
                <Package size={36} className="w-9 h-9 text-slate-300 mx-auto" />
                <div className="font-bold text-slate-700">No orders match the current criteria</div>
                <div className="text-xs text-slate-400">
                  {orderSearch ? `No matches found for "${orderSearch}"` : 'Try selecting a different time range or status filter.'}
                </div>
                {(orderSearch || orderStatusFilter !== 'ALL') && (
                  <button
                    onClick={() => { setOrderSearch(''); setOrderStatusFilter('ALL'); }}
                    className="mt-2 text-xs font-bold text-emerald-600 hover:text-emerald-800 underline"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : orderViewMode === 'TABLE' ? (
              /* High-Density Compact Table View */
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="py-2.5 px-3">Order #</th>
                      <th className="py-2.5 px-3">Student</th>
                      <th className="py-2.5 px-3">Items Summary</th>
                      <th className="py-2.5 px-3">Pickup Slot</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Placed At</th>
                      <th className="py-2.5 px-3 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {paginatedOrders.map(order => {
                      const isExpanded = expandedOrderIds.has(order.id);
                      const totalItems = order.order_items?.reduce((s: number, i: any) => s + (i.quantity || 0), 0) || 0;
                      const totalAmount = order.order_items?.reduce((s: number, i: any) => s + ((Number(i.menu_items?.price) || 0) * (i.quantity || 1)), 0) || 0;

                      return (
                        <React.Fragment key={order.id}>
                          <tr 
                            onClick={() => toggleExpandOrder(order.id)}
                            className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${
                              isExpanded ? 'bg-slate-50/50' : ''
                            }`}
                          >
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="font-extrabold text-slate-900">#{order.order_number}</span>
                              <span className="text-[10px] text-slate-400 font-mono block">
                                {order.id.split('-')[0].toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <div className="font-semibold text-slate-800">{order.profiles?.name || 'Student'}</div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                {order.profiles?.id_number || 'No ID'}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5 flex-wrap max-w-xs">
                                <span className="font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                                  {totalItems} {totalItems === 1 ? 'item' : 'items'}
                                </span>
                                <span className="text-slate-600 truncate max-w-[180px]" title={order.order_items?.map((i: any) => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}>
                                  {order.order_items?.map((i: any) => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full text-[11px]">
                                {formatPickupTime(order.pickup_time)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                                order.status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' :
                                order.status === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                order.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                                'bg-slate-100 text-slate-700 border-slate-200'
                              }`}>
                                {order.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 text-[11px]">
                              {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleExpandOrder(order.id); }}
                                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors"
                                title="Toggle order details"
                              >
                                {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/70 border-b border-slate-200">
                              <td colSpan={7} className="p-3">
                                <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                                  <div className="flex justify-between items-center text-xs border-b border-slate-100 pb-1.5">
                                    <span className="font-bold text-slate-800">Order Items Breakdown</span>
                                    {totalAmount > 0 && (
                                      <span className="font-extrabold text-emerald-700">Total: ₹{totalAmount.toFixed(2)}</span>
                                    )}
                                  </div>
                                  <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                    {order.order_items?.map((item: any) => (
                                      <li key={item.id} className="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-100 text-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-black bg-slate-200 text-slate-800 px-1.5 py-0.2 rounded text-[10px]">
                                            {item.quantity}x
                                          </span>
                                          <span className="font-semibold text-slate-700 truncate max-w-[130px]">{item.menu_items?.name}</span>
                                        </div>
                                        {item.menu_items?.price && (
                                          <span className="text-slate-500 font-mono text-[11px]">
                                            ₹{(Number(item.menu_items.price) * item.quantity).toFixed(2)}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {paginatedOrders.map(order => (
                  <div key={order.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between gap-2.5 hover:border-emerald-300 transition-colors shadow-xs bg-white">
                    <div>
                      <div className="flex justify-between items-start mb-1.5">
                        <div>
                          <h3 className="font-bold text-slate-900 text-sm sm:text-base">Order #{order.order_number}</h3>
                          <div className="text-[10px] text-slate-400 font-mono">ID: {order.id.split('-')[0].toUpperCase()}</div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                          order.status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' :
                          order.status === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          order.status === 'PREPARING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                          order.status === 'ACCEPTED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          order.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                          'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {order.status}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 mb-1">
                        <span className="font-semibold">{order.profiles?.name || 'Student'}</span>
                        <span className="text-slate-400 font-mono ml-1.5">({order.profiles?.id_number || 'No ID'})</span>
                      </div>

                      <div className="text-[11px] text-indigo-600 font-bold bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-0.5 inline-block mb-2">
                        Pickup: {formatPickupTime(order.pickup_time)}
                      </div>

                      <div className="pt-2 border-t border-slate-100">
                        <ul className="space-y-1">
                          {order.order_items?.map((item: any) => (
                            <li key={item.id} className="text-xs text-slate-700 flex justify-between">
                              <span><span className="font-bold text-slate-900">{item.quantity}x</span> {item.menu_items?.name}</span>
                              {item.menu_items?.price && (
                                <span className="text-slate-400 font-mono text-[11px]">
                                  ₹{(Number(item.menu_items.price) * item.quantity).toFixed(0)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-400 border-t border-slate-100 pt-2 flex justify-between">
                      <span>{new Date(order.created_at).toLocaleDateString()}</span>
                      <span>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination Bar */}
          {filteredAdminOrders.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-2.5 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span>
                  Showing <strong>{(currentPage - 1) * pageSize + 1}</strong>-<strong>{Math.min(currentPage * pageSize, filteredAdminOrders.length)}</strong> of <strong>{filteredAdminOrders.length}</strong>
                </span>
                <span className="text-slate-300">|</span>
                <label className="flex items-center gap-1.5">
                  <span>Per page:</span>
                  <select
                    value={pageSize}
                    onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 text-xs font-semibold text-slate-700 focus:outline-none"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft size={15} />
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
                            onClick={() => setCurrentPage(p)}
                            className={`w-6 h-6 rounded-lg text-xs font-bold transition-all ${
                              currentPage === p
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
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : isMenuView ? (
        /* Dedicated View 2: Manage Menu */
        <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl p-5 sm:p-7 shadow-xl shadow-emerald-500/5 hover:shadow-emerald-500/10 transition-all duration-300">
          {/* Top ambient accent glow */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-emerald-500 to-teal-500 rounded-t-3xl" />
          <div className="absolute -top-20 -right-20 w-56 h-56 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header Section */}
          <div className="flex flex-col items-center text-center mb-4 relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-2 ring-4 ring-emerald-50/70">
              <Utensils size={28} strokeWidth={2.2} />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Manage Menu</h1>
              <span className="text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full">
                {filteredMenuItems.length} / {menuItems.length} items
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-0.5 leading-snug">
              Register fresh cooked or packed dishes, configure prices, and toggle live stock availability.
            </p>

            {/* Metric Badges Row */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {menuItems.filter(i => !i.is_sold_out).length} In Stock
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/70 shadow-xs">
                {menuItems.filter(i => i.is_sold_out).length} Sold Out
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/70 shadow-xs">
                {menuItems.length} Total Items
              </span>
            </div>
          </div>

          {/* Add New Item Form Surface (Exact Match to Screenshot 2) */}
          <div className="bg-slate-50/75 border border-slate-200/80 rounded-2xl p-4 mb-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <span className="font-extrabold text-[11px] text-slate-600 uppercase tracking-wider">
                Food Type
              </span>
              <div className="flex bg-slate-200/70 p-0.5 rounded-xl border border-slate-300/50">
                <button
                  type="button"
                  onClick={() => setNewItemCategory('FRESH')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    newItemCategory === 'FRESH'
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Utensils size={13} />
                  <span>Fresh Cooked</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewItemCategory('PACKED')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    newItemCategory === 'PACKED'
                      ? 'bg-white text-purple-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Package size={13} />
                  <span>Packed Food</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className={`${newItemCategory === 'PACKED' ? 'sm:col-span-5' : 'sm:col-span-7'}`}>
                  <input
                    type="text"
                    required
                    placeholder="Item Name (e.g. Veg Meals, Dosa)"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-xs sm:text-sm placeholder:text-slate-400"
                  />
                </div>
                <div className="sm:col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="₹ Price"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-xs sm:text-sm font-semibold placeholder:text-slate-400"
                  />
                </div>
                <div className="sm:col-span-3">
                  <select
                    value={newItemType}
                    onChange={(e) => setNewItemType(e.target.value as FoodType)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-xs sm:text-sm font-bold text-slate-700"
                  >
                    <option value="VEG">Veg</option>
                    <option value="NON_VEG">Non-Veg</option>
                  </select>
                </div>
                {newItemCategory === 'PACKED' && (
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min="0"
                      placeholder="Qty"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:outline-none text-xs sm:text-sm placeholder:text-slate-400 font-bold"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pt-1">
                <p className="text-[11px] text-slate-400 italic">
                  {newItemCategory === 'FRESH'
                    ? 'Freshly prepared in kitchen on order'
                    : 'Packaged snack/beverage with inventory count'}
                </p>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <Plus size={14} strokeWidth={2.5} />
                  <span>+ Add Item</span>
                </button>
              </div>
            </form>
          </div>

          {/* Search & Filter Toolbar (Exact Match to Screenshot 2) */}
          <div className="space-y-2.5 mb-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, price, or type..."
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 placeholder:text-slate-400 shadow-xs"
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
          <div className="max-h-[320px] overflow-y-auto pr-1">
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
                {filteredMenuItems.map(item => (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-2 shadow-xs ${
                      item.is_sold_out
                        ? 'bg-slate-50/60 border-slate-200 opacity-70'
                        : 'bg-white border-slate-200/90 hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-extrabold text-slate-900 text-sm truncate">{item.name}</h4>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-black border ${
                            item.veg_non_veg === 'VEG'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            {item.veg_non_veg === 'VEG' ? 'VEG' : 'NON-VEG'}
                          </span>
                          {item.name.toLowerCase().includes('packed') && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-black bg-purple-50 text-purple-700 border border-purple-200">
                              PACKED
                            </span>
                          )}
                        </div>
                        <div className="font-black text-emerald-700 text-sm mt-0.5">
                          ₹{Number(item.price).toFixed(2)}
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
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border ${
                          item.is_sold_out
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        {item.is_sold_out ? 'Mark Available' : 'Mark Sold Out'}
                      </button>
                    </div>
                  </div>
                ))}
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
        /* Dedicated View 4: Manage Staff & Penalties */
        <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl p-5 sm:p-7 shadow-xl shadow-emerald-500/5 hover:shadow-emerald-500/10 transition-all duration-300">
          {/* Top ambient accent glow */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-emerald-500 to-teal-500 rounded-t-3xl" />
          <div className="absolute -top-20 -right-20 w-56 h-56 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header Section */}
          <div className="flex flex-col items-center text-center mb-4 relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-2 ring-4 ring-emerald-50/70">
              <Users size={28} strokeWidth={2.2} />
            </div>
            <h1 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Manage Staff</h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-0.5 leading-snug">
              Create kitchen staff credentials and supervise student pickup penalties and suspensions.
            </p>

            {/* Metric Badges Row */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/70 shadow-xs">
                <Users size={13} />
                {canteenStaff.length} Staff Member{canteenStaff.length === 1 ? '' : 's'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/70 shadow-xs">
                <IconAlertTriangle size={13} className="text-amber-600" />
                {penalizedStudents.length} Flagged Student{penalizedStudents.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
            {/* Form: Create New Staff User (Exact Match to Screenshot 4) */}
            <form onSubmit={handleCreateStaff} className="bg-slate-50/80 p-4 sm:p-5 rounded-2xl border border-slate-200">
              <h3 className="font-bold text-slate-800 text-sm mb-3">Create New Staff User</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <input
                  type="text"
                  required
                  placeholder="Full Name"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-xs sm:text-sm"
                />
                <input
                  type="email"
                  required
                  placeholder="Email Address"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-xs sm:text-sm"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Password (Min. 6 chars)"
                  value={newStaffPassword}
                  onChange={(e) => setNewStaffPassword(e.target.value)}
                  className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-xs sm:text-sm"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={creatingStaff}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition shadow-xs cursor-pointer active:scale-95"
                >
                  {creatingStaff ? 'Creating...' : 'Create Staff'}
                </button>
              </div>
            </form>

            {/* Kitchen Staff List (if any exist) */}
            {canteenStaff.length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-2.5">
                  Assigned Kitchen Staff ({canteenStaff.length})
                </h4>
                <div className="space-y-1.5">
                  {canteenStaff.map(s => (
                    <div key={s.id} className="flex justify-between items-center p-2 rounded-xl bg-slate-50 text-xs">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-slate-400" />
                        <span className="font-bold text-slate-800">{s.name || 'Staff User'}</span>
                        <span className="text-slate-400 font-mono text-[11px]">{s.id_number ? `ID: ${s.id_number}` : 'Staff'}</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Staff
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Student Penalties & Account Suspensions (Exact Match to Screenshot 4) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-3">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-1.5">
                    <IconAlertTriangle size={18} className="w-4.5 h-4.5 text-amber-600 shrink-0" />
                    <span>Student No-Show Penalties &amp; Suspensions</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Students receive 1 strike per missed pickup. 2 strikes trigger an automatic 3-day account deactivation.
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full w-fit">
                  {penalizedStudents.length} Students with records
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
                  <span className="text-2xl font-black text-slate-900">{canteenStaff.length}</span>
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
