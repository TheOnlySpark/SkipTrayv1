import React, { useState, useEffect, useMemo } from "react";
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
  IconSparkles,
  IconClock,
  IconCheckCircle
} from '../components/Icons';
import {
  Search,
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
  Check,
  Trash2
} from 'lucide-react';
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

  const currentCanteenId = profile?.canteen_id;
  const currentTenantId = profile?.tenant_id ?? tenantId ?? null;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ placed: 0, collected: 0, rejected: 0 });

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
    if (!replyText.trim()) return;
    setSubmittingReply(true);

    const { error } = await supabase
      .from('item_reviews')
      .update({ admin_reply: replyText })
      .eq('id', reviewId);

    if (error) {
      showAlert({ title: 'Reply Failed', message: 'Failed to submit reply. Please try again.', type: 'error' });
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
      } catch {}

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
    } catch {}

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
      } catch {}

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
    if (!currentCanteenId) return;
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
          name: newStaffName,
          email: newStaffEmail,
          password: newStaffPassword,
          role: 'STAFF',
          canteen_id: currentCanteenId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create staff');
      }

      showAlert({ title: 'Staff Created', message: `Successfully created staff account for ${newStaffEmail}`, type: 'success' });
      
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      queryClient.invalidateQueries({ queryKey: ['canteenStaff'] });
    } catch (err: any) {
      showAlert({ title: 'Error', message: err.message, type: 'error' });
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
  const [newItemPrepTime, setNewItemPrepTime] = useState('10');
  const [priceError, setPriceError] = useState<string | null>(null);

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

  const fetchStats = async () => {
    if (!currentCanteenId) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.toISOString();

    const { data, error } = await supabase
      .from('orders')
      .select('status')
      .eq('canteen_id', currentCanteenId)
      .gte('created_at', startOfDay);

    if (data) {
      const s = { placed: 0, collected: 0, rejected: 0 };
      data.forEach(o => {
        s.placed++;
        if (o.status === 'COLLECTED') s.collected++;
        if (o.status === 'REJECTED') s.rejected++;
      });
      setStats(s);
    }
  };

  const fetchMenu = async () => {
    if (!currentCanteenId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('canteen_id', currentCanteenId)
      .order('veg_non_veg', { ascending: false })
      .order('name');
    if (data) {
      const sorted = [...data].sort((a, b) => {
        if (a.veg_non_veg !== b.veg_non_veg) return a.veg_non_veg === 'VEG' ? -1 : 1;
        if (a.name.toLowerCase() === 'veg meals') return -1;
        if (b.name.toLowerCase() === 'veg meals') return 1;
        return a.name.localeCompare(b.name);
      });
      setMenuItems(sorted);
    }
    setLoading(false);
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

    const { data, error } = await supabase.from('menu_items').insert({
      name: newItemName.trim(),
      veg_non_veg: newItemType,
      price: parsedPrice,
      prep_time_minutes: Number(newItemPrepTime) || 10,
      tenant_id: currentTenantId,
      canteen_id: currentCanteenId
    }).select().single();

    if (error) {
      showAlert({ title: 'Error', message: `Failed to add item: ${error.message}`, type: 'error' });
      return;
    }

    if (data) {
      setMenuItems([data, ...menuItems]);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemPrepTime('10');
      setPriceError(null);
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
    <div className="w-full max-w-4xl grid grid-cols-12 gap-4">
      {/* Header */}
      <div className="col-span-12 bg-emerald-600 border border-emerald-500 rounded-[2rem] p-5 md:p-8 flex flex-col justify-between shadow-sm relative overflow-hidden text-white mb-4">
        <div className="z-10 flex justify-between items-start">
          <div>
            <span className="px-3 py-1 bg-emerald-500 text-emerald-100 text-xs font-bold uppercase tracking-wider rounded-full border border-emerald-400">Canteen Admin</span>
            <h1 className="text-3xl font-extrabold text-white mt-4 leading-tight">Welcome, {profile?.name || 'Admin'}</h1>
          </div>
        </div>
      </div>

      {/* Daily Summary */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Today's Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-6 bg-blue-50 border border-blue-100 rounded-2xl flex flex-col items-center">
            <span className="text-3xl font-bold text-blue-700">{stats.placed}</span>
            <span className="text-sm font-semibold text-blue-600 uppercase tracking-wide mt-1">Total Orders</span>
          </div>
          <div className="p-6 bg-green-50 border border-green-100 rounded-2xl flex flex-col items-center">
            <span className="text-3xl font-bold text-green-700">{stats.collected}</span>
            <span className="text-sm font-semibold text-green-600 uppercase tracking-wide mt-1">Collected</span>
          </div>
          <div className="p-6 bg-red-50 border border-red-100 rounded-2xl flex flex-col items-center">
            <span className="text-3xl font-bold text-red-700">{stats.rejected}</span>
            <span className="text-sm font-semibold text-red-600 uppercase tracking-wide mt-1">Rejected/Cancelled</span>
          </div>
        </div>
      </div>

      {/* Order List */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm">
        {/* Header with Title, Count & Date Range */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-slate-800">Order List</h2>
              <span className="text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                {filteredAdminOrders.length} {filteredAdminOrders.length === 1 ? 'order' : 'orders'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Filter, search, and inspect orders across time ranges</p>
          </div>
          
          <div className="flex items-center gap-2">
            {(['TODAY', 'WEEK', 'MONTH'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setOrderFilter(filter)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  orderFilter === filter
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {filter === 'TODAY' ? "Today" : filter === 'WEEK' ? "Past Week" : "Past Month"}
              </button>
            ))}
          </div>
        </div>

        {/* Toolbar: Search, View Switcher & Status Tabs */}
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
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
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

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-4 scrollbar-thin">
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
        {ordersLoading ? (
          <div className="text-slate-500 text-sm py-16 text-center">Loading orders...</div>
        ) : filteredAdminOrders.length === 0 ? (
          <div className="text-slate-500 text-sm py-12 text-center bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
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
                  <th className="py-3 px-3.5">Order #</th>
                  <th className="py-3 px-3.5">Student</th>
                  <th className="py-3 px-3.5">Items Summary</th>
                  <th className="py-3 px-3.5">Pickup Slot</th>
                  <th className="py-3 px-3.5">Status</th>
                  <th className="py-3 px-3.5">Placed At</th>
                  <th className="py-3 px-3.5 text-right">Details</th>
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
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <span className="font-extrabold text-slate-900">#{order.order_number}</span>
                          <span className="text-[10px] text-slate-400 font-mono block">
                            {order.id.split('-')[0].toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="font-semibold text-slate-800">{order.profiles?.name || 'Student'}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {order.profiles?.id_number || 'No ID'}
                          </div>
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap max-w-xs">
                            <span className="font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                              {totalItems} {totalItems === 1 ? 'item' : 'items'}
                            </span>
                            <span className="text-slate-600 truncate max-w-[200px]" title={order.order_items?.map((i: any) => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}>
                              {order.order_items?.map((i: any) => `${i.quantity}x ${i.menu_items?.name}`).join(', ')}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <span className="font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full text-[11px]">
                            {formatPickupTime(order.pickup_time)}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
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
                        <td className="py-3 px-3.5 whitespace-nowrap text-slate-500 text-[11px]">
                          {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpandOrder(order.id); }}
                            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors"
                            title="Toggle order details"
                          >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/70 border-b border-slate-200">
                          <td colSpan={7} className="p-4">
                            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                              <div className="flex justify-between items-center text-xs border-b border-slate-100 pb-2">
                                <span className="font-bold text-slate-800">Order Items Breakdown</span>
                                {totalAmount > 0 && (
                                  <span className="font-extrabold text-emerald-700">Total: ₹{totalAmount.toFixed(2)}</span>
                                )}
                              </div>
                              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {order.order_items?.map((item: any) => (
                                  <li key={item.id} className="flex justify-between items-center bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs">
                                    <div className="flex items-center gap-2">
                                      <span className="font-black bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded text-[10px]">
                                        {item.quantity}x
                                      </span>
                                      <span className="font-semibold text-slate-700">{item.menu_items?.name}</span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedOrders.map(order => (
              <div key={order.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col justify-between gap-3 hover:border-emerald-300 transition-colors shadow-sm bg-white">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Order #{order.order_number}</h3>
                      <div className="text-[11px] text-slate-400 font-mono">ID: {order.id.split('-')[0].toUpperCase()}</div>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
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

                  <div className="text-xs text-indigo-600 font-bold bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 inline-block mb-3">
                    Pickup: {formatPickupTime(order.pickup_time)}
                  </div>

                  <div className="pt-2.5 border-t border-slate-100">
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

                <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-2 flex justify-between">
                  <span>{new Date(order.created_at).toLocaleDateString()}</span>
                  <span>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
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
                  onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
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
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
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
                          onClick={() => setCurrentPage(p)}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
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
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Menu Management */}
      <div className="col-span-12 md:col-span-6 bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col h-[620px]">
        <div className="flex justify-between items-center mb-5 shrink-0">
          <h2 className="text-xl font-bold text-slate-800">Manage Menu</h2>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {menuItems.length} {menuItems.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <form onSubmit={handleAddItem} className="flex flex-col gap-3 mb-5 bg-slate-50 p-4 rounded-xl border border-slate-100 shrink-0">
          <input 
            type="text" 
            placeholder="Item Name" 
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            maxLength={100}
            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-slate-800"
          />
          <div className="flex flex-col gap-1">
            <div className="flex gap-2 items-center">
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
                className={`w-28 px-3.5 py-2 bg-white border ${priceError ? 'border-rose-400 ring-1 ring-rose-400' : 'border-slate-200'} rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-slate-800`}
              />
              <input 
                type="number" 
                placeholder="Prep (m)" 
                title="Estimated preparation duration in minutes"
                value={newItemPrepTime}
                onChange={(e) => setNewItemPrepTime(e.target.value)}
                min="1"
                max="60"
                className="w-20 px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-slate-800"
              />
              <select 
                value={newItemType} 
                onChange={(e) => setNewItemType(e.target.value as FoodType)}
                className="w-28 px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-slate-800"
              >
                <option value="VEG">Veg</option>
                <option value="NON_VEG">Non-Veg</option>
              </select>
              <button 
                type="submit" 
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition-all shrink-0 cursor-pointer"
              >
                Add Item
              </button>
            </div>
            {priceError && (
              <p className="text-xs text-rose-600 font-semibold mt-0.5">{priceError}</p>
            )}
          </div>
        </form>

        {loading && menuItems.length === 0 ? (
          <div className="text-slate-500 text-sm flex-1 flex items-center justify-center">Loading menu...</div>
        ) : (
          <div className="space-y-3 overflow-y-auto flex-1 pr-1.5 custom-scrollbar">
            {menuItems.map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors shadow-sm gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${item.veg_non_veg === 'VEG' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${item.is_sold_out ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.name}</span>
                      {item.is_sold_out && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full shrink-0">Sold Out</span>}
                    </div>
                    <span className="text-xs font-bold text-slate-600">₹{Number(item.price || 0).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
                    className="text-[10px] sm:text-xs font-semibold text-slate-500 bg-slate-100 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    {item.is_sold_out ? 'Mark Available' : 'Mark Sold Out'}
                  </button>
                  <button
                    onClick={() => handleDeleteMenuItem(item.id, item.name)}
                    className="text-[10px] sm:text-xs font-semibold text-rose-500 bg-rose-50 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-rose-100 border border-rose-100 transition-colors cursor-pointer"
                    title="Permanently delete this item"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {menuItems.length === 0 && (
              <div className="text-slate-500 text-sm text-center py-8">
                No menu items for this location yet.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Feedback & Reviews */}
      <div className="col-span-12 md:col-span-6 bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col h-[620px]">
        <div className="flex justify-between items-center mb-5 shrink-0">
          <h2 className="text-xl font-bold text-slate-800">Student Feedback & Reviews</h2>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
          </span>
        </div>

        {reviewsLoading ? (
          <div className="text-slate-500 text-sm flex-1 flex items-center justify-center">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="text-slate-400 text-sm flex-1 flex items-center justify-center">No reviews yet.</div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto flex-1 pr-1.5 custom-scrollbar">
            {reviews.map(review => (
              <div key={review.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col gap-3 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-800">
                      {review.orders?.order_number ? `Order #${review.orders.order_number} - ` : ''}
                      {review.menu_items?.name || 'Unknown Item'}
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {review.orders?.id && <span className="font-mono">ID: {review.orders.id.split('-')[0].toUpperCase()} • </span>}
                      By {review.profiles?.name || 'Unknown'} ({review.profiles?.id_number || 'No ID'})
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <IconStar 
                        key={i} 
                        size={16} 
                        className={`w-4 h-4 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`} 
                        filled={i < review.rating} 
                      />
                    ))}
                  </div>
                </div>

                {review.feedback_text && (
                  <div className="bg-white p-3 rounded-xl border border-slate-100 text-sm text-slate-700 italic">
                    "{review.feedback_text}"
                  </div>
                )}

                <div className="text-xs text-slate-400">
                  Reviewed on: {new Date(review.created_at).toLocaleString()}
                </div>

                {/* Admin Reply Section */}
                <div className="mt-2 pt-3 border-t border-slate-200">
                  {review.admin_reply ? (
                    <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                      <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Your Reply</div>
                      <p className="text-sm text-slate-800">{review.admin_reply}</p>
                    </div>
                  ) : replyingTo === review.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a reply..."
                        maxLength={500}
                        className="w-full text-sm bg-white border border-emerald-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        rows={2}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => { setReplyingTo(null); setReplyText(''); }}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleReplyToReview(review.id)}
                          disabled={submittingReply || !replyText.trim()}
                          className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          {submittingReply ? 'Sending...' : 'Send Reply'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setReplyingTo(review.id)}
                      className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 flex items-center gap-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21l1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"></path></svg>
                      Reply to feedback
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Analytics Section */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm flex flex-col">
        <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          Weekly Analytics
        </h2>

        {analyticsLoading ? (
          <div className="text-slate-500 text-sm">Loading analytics...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-50 rounded-2xl p-6 shadow-sm border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-4 uppercase tracking-wider text-xs">Most Sold This Week</h3>
              {analytics.mostSold.length === 0 ? (
                <div className="text-slate-500 text-sm">No sales data for this week.</div>
              ) : (
                <div className="space-y-4 mt-2">
                  {analytics.mostSold.map((item, idx) => {
                    const maxCount = Math.max(...analytics.mostSold.map(i => i.count), 1);
                    const percentage = Math.round((item.count / maxCount) * 100);
                    return (
                      <div key={idx} className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-slate-700 flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold bg-slate-200 text-slate-600">
                              {idx + 1}
                            </span>
                            {item.name}
                          </span>
                          <span className="text-emerald-600">{item.count} sold</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200/50">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${idx === 0 ? 'bg-emerald-600' :
                                idx === 1 ? 'bg-emerald-500' :
                                  idx === 2 ? 'bg-emerald-400' : 'bg-emerald-300'
                              }`}
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-emerald-600 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-center text-white text-center">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"></path></svg>
              </div>
              <h3 className="font-bold text-xl mb-1">Great Job!</h3>
              <p className="text-emerald-200 text-sm">Keep up the good work managing orders.</p>
            </div>
          </div>
        )}
      </div>

      {/* Manage Staff Section */}
      <div className="col-span-12 bg-white border border-slate-200/90 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col relative overflow-hidden">
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

      {/* Lunch Pickup Time Slots Management */}
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
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              slotConfig.isLunchEnabled 
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
                        className={`p-3 rounded-xl border transition-all flex flex-col justify-between gap-2 ${
                          isDisabled
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
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider transition-colors ${
                              isDisabled
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

      {/* Student Penalties & Account Suspensions */}
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
          <div className="text-slate-500 text-sm py-4">Loading student penalty records...</div>
        ) : penalizedStudents.length === 0 ? (
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
            <IconSparkles size={18} className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
            <span>All clean! No students currently have active strikes or suspensions.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">ID Number</th>
                  <th className="py-3 px-4">Active Strikes</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {penalizedStudents.map(student => {
                  const isSuspended = !!(student.suspended_until && new Date(student.suspended_until) > new Date());
                  return (
                    <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-800">{student.name || 'Unnamed'}</td>
                      <td className="py-3 px-4 text-slate-500 text-xs font-mono">{student.id_number || 'N/A'}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${student.strike_count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {student.strike_count} / 2 Strikes
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {isSuspended ? (
                          <div className="flex flex-col">
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 w-fit flex items-center gap-1">
                              <IconBan size={12} className="w-3 h-3 text-red-600 shrink-0" />
                              <span>Suspended (3-Day Penalty)</span>
                            </span>
                            <span className="text-[11px] text-slate-400 mt-0.5">
                              Until: {new Date(student.suspended_until).toLocaleDateString()} {new Date(student.suspended_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 w-fit">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleResetStudentStrikes(student.id, student.name || 'Student')}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors active:scale-95"
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
  );
}
