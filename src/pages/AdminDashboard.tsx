import React from "react";
import { useState, useEffect } from 'react';
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

type Canteen = Database['public']['Tables']['canteens']['Row'];

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type FoodType = Database['public']['Enums']['food_type'];
type Review = Database['public']['Tables']['item_reviews']['Row'] & {
  menu_items: { name: string } | null;
  profiles: { name: string | null; id_number: string | null } | null;
  orders: { id: string; order_number: number } | null;
};

export default function AdminDashboard() {
  const { profile, signOut } = useAuth();
  const { tenantId } = useTenant();
  const { showAlert, showConfirm } = useDialog();
  const queryClient = useQueryClient();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ placed: 0, collected: 0, rejected: 0 });

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [orderFilter, setOrderFilter] = useState<'TODAY' | 'WEEK' | 'MONTH'>('TODAY');
  const [devIgnoreTime, setDevIgnoreTime] = useState(
    localStorage.getItem('dev_ignore_time_constraints') === 'true'
  );

  const toggleDevIgnoreTime = () => {
    const newValue = !devIgnoreTime;
    setDevIgnoreTime(newValue);
    if (newValue) {
      localStorage.setItem('dev_ignore_time_constraints', 'true');
    } else {
      localStorage.removeItem('dev_ignore_time_constraints');
    }
  };

  const { data: allOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['adminOrders', orderFilter],
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
            menu_items (name)
          )
        `)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      return (data as any[]) || [];
    }
  });

  const { data: analytics = { mostSold: [] }, isLoading: analyticsLoading } = useQuery({
    queryKey: ['adminAnalytics'],
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
    queryKey: ['adminReviews'],
    queryFn: async () => {
      const { data } = await supabase
        .from('item_reviews')
        .select(`
          *,
          menu_items (name),
          profiles (name, id_number),
          orders (id, order_number)
        `)
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
      showAlert({
        title: 'Reply Failed',
        message: 'Failed to submit reply. Please try again.',
        type: 'error'
      });
    } else {
      setReplyingTo(null);
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['adminReviews'] });
      showAlert({
        title: 'Reply Published',
        message: 'Your reply has been published to the student review.',
        type: 'success'
      });
    }
    setSubmittingReply(false);
  };

  const { data: penalizedStudents = [], isLoading: penaltiesLoading } = useQuery({
    queryKey: ['penalizedStudents'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .or('strike_count.gt.0,suspended_until.not.is.null')
        .order('name');
      return (data as any[]) || [];
    }
  });

  const [staffSearchText, setStaffSearchText] = useState('');
  const { data: tenantUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['tenantUsers', staffSearchText],
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('*')
        .in('role', ['STAFF', 'STUDENT'])
        .order('role', { ascending: true })
        .order('name');
        
      if (staffSearchText) {
        q = q.ilike('name', `%${staffSearchText}%`);
      }
      
      const { data } = await q.limit(20);
      return (data as any[]) || [];
    }
  });

  const handleToggleStaffRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'STAFF' ? 'STUDENT' : 'STAFF';
    
    const confirmed = await showConfirm({
      title: 'Change Role',
      message: `Are you sure you want to change this user's role to ${newRole}?`,
      confirmText: 'Yes, Change Role',
      cancelText: 'Cancel',
      type: 'info'
    });
    
    if (!confirmed) return;

    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      showAlert({
        title: 'Error',
        message: `Failed to update role: ${error.message}`,
        type: 'error'
      });
      return;
    }
    
    queryClient.invalidateQueries({ queryKey: ['tenantUsers'] });
  };

  const [isCreatingStaff, setIsCreatingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
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
          role: 'STAFF'
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create staff');
      }

      showAlert({
        title: 'Staff Created',
        message: `Successfully created staff account for ${newStaffEmail}`,
        type: 'success'
      });
      
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      setIsCreatingStaff(false);
      queryClient.invalidateQueries({ queryKey: ['tenantUsers'] });
    } catch (err: any) {
      showAlert({
        title: 'Error',
        message: err.message,
        type: 'error'
      });
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

    const { error } = await supabase.rpc('admin_reset_student_strikes', {
      p_student_id: studentId
    });
    if (error) {
      showAlert({
        title: 'Reset Failed',
        message: `Failed to reset strikes: ${error.message}`,
        type: 'error'
      });
      return;
    }
    showAlert({
      title: 'Strikes Cleared',
      message: `Strikes and suspension have been cleared for ${studentName || 'student'}.`,
      type: 'success'
    });
    queryClient.invalidateQueries({ queryKey: ['penalizedStudents'] });
  };

  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemType, setNewItemType] = useState<FoodType>('VEG');
  const [newCanteenName, setNewCanteenName] = useState('');
  const [newCanteenCode, setNewCanteenCode] = useState('');
  const [creatingCanteen, setCreatingCanteen] = useState(false);
  const [selectedMenuCanteenId, setSelectedMenuCanteenId] = useState('');

  const currentTenantId = profile?.tenant_id ?? tenantId ?? null;
  const { data: canteens = [], isLoading: canteensLoading, error: canteensError } = useQuery({
    queryKey: ['adminCanteens', currentTenantId],
    enabled: !!currentTenantId,
    queryFn: async () => {
      if (!currentTenantId) return [];
      const { data, error } = await supabase
        .from('canteens')
        .select('*')
        .eq('tenant_id', currentTenantId)
        .order('name');
      if (error) throw error;
      return data as Canteen[];
    }
  });
  const activeCanteens = canteens.filter(canteen => canteen.is_active);

  useEffect(() => {
    if (!activeCanteens.some(canteen => canteen.id === selectedMenuCanteenId)) {
      setSelectedMenuCanteenId(activeCanteens[0]?.id ?? '');
    }
  }, [activeCanteens, selectedMenuCanteenId]);

  useEffect(() => {
    if (!currentTenantId) return;

    const canteenSub = supabase
      .channel(`admin_canteens_${currentTenantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'canteens',
        filter: `tenant_id=eq.${currentTenantId}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
      })
      .subscribe();

    return () => {
      canteenSub.unsubscribe();
    };
  }, [currentTenantId, queryClient]);

  useEffect(() => {
    fetchMenu();
    fetchStats();

    const orderSub = supabase
      .channel('admin:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchStats();
        queryClient.invalidateQueries({ queryKey: ['adminOrders'] });
        queryClient.invalidateQueries({ queryKey: ['adminAnalytics'] });
      })
      .subscribe();

    const menuSub = supabase
      .channel('admin:menu_items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
        fetchMenu();
      })
      .subscribe();

    const reviewSub = supabase
      .channel('admin:item_reviews')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_reviews' }, () => {
        queryClient.invalidateQueries({ queryKey: ['adminReviews'] });
      })
      .subscribe();

    return () => {
      orderSub.unsubscribe();
      menuSub.unsubscribe();
      reviewSub.unsubscribe();
    };
  }, [queryClient]);

  const fetchStats = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.toISOString();

    const { data, error } = await supabase
      .from('orders')
      .select('status')
      .gte('created_at', startOfDay);

    if (data) {
      const s = { placed: 0, collected: 0, rejected: 0 };
      data.forEach(o => {
        s.placed++; // any order created today was "placed"
        if (o.status === 'COLLECTED') s.collected++;
        if (o.status === 'REJECTED') s.rejected++;
      });
      setStats(s);
    }
  };

  const fetchMenu = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
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
    setLoading(false);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const parsedPrice = parseFloat(newItemPrice) || 0;
    const tenantKey = currentTenantId;
    if (!tenantKey) {
      showAlert({
        title: 'Missing tenant',
        message: 'Your tenant context is unavailable. Please refresh and try again.',
        type: 'error'
      });
      return;
    }

    if (!activeCanteens.some(canteen => canteen.id === selectedMenuCanteenId)) {
      showAlert({
        title: 'Canteen missing',
        message: 'Select an active canteen before adding a menu item.',
        type: 'error'
      });
      return;
    }

    const { data, error } = await supabase.from('menu_items').insert({
      name: newItemName,
      veg_non_veg: newItemType,
      price: parsedPrice,
      tenant_id: tenantKey,
      canteen_id: selectedMenuCanteenId
    }).select().single();

    if (error) {
      showAlert({
        title: 'Error',
        message: `Failed to add item: ${error.message}`,
        type: 'error'
      });
      return;
    }

    if (data) {
      setMenuItems([data, ...menuItems]);
      setNewItemName('');
      setNewItemPrice('');
    }
  };

  const handleAddCanteen = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCanteenName.trim();
    if (!name) return;

    if (!currentTenantId) {
      showAlert({
        title: 'Missing tenant',
        message: 'Your tenant context is unavailable. Please refresh and try again.',
        type: 'error'
      });
      return;
    }

    setCreatingCanteen(true);
    const { error } = await supabase.from('canteens').insert({
      name,
      code: newCanteenCode.trim().toUpperCase() || null,
      tenant_id: currentTenantId
    });
    setCreatingCanteen(false);

    if (error) {
      showAlert({
        title: 'Could not add location',
        message: error.message,
        type: 'error'
      });
      return;
    }

    setNewCanteenName('');
    setNewCanteenCode('');
    await queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
    showAlert({
      title: 'Location added',
      message: `${name} is now available as a canteen location.`,
      type: 'success'
    });
  };

  const handleToggleCanteen = async (canteen: Canteen) => {
    if (canteen.is_active && activeCanteens.length === 1) {
      showAlert({
        title: 'Keep one location active',
        message: 'At least one active canteen is needed for students to place orders.',
        type: 'error'
      });
      return;
    }

    const { data, error } = await supabase
      .from('canteens')
      .update({ is_active: !canteen.is_active })
      .eq('id', canteen.id)
      .select('id, is_active')
      .maybeSingle();

    if (error) {
      showAlert({
        title: 'Could not update location',
        message: error.message,
        type: 'error'
      });
      return;
    }

    if (!data) {
      showAlert({
        title: 'Location was not updated',
        message: 'No location was changed. Check that this location belongs to your organization and that your account has admin access.',
        type: 'error'
      });
      await queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
      return;
    }

    queryClient.setQueryData<Canteen[]>(['adminCanteens', currentTenantId], current =>
      current?.map(location => location.id === data.id
        ? { ...location, is_active: data.is_active }
        : location)
    );
    await queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
  };

  const handleToggleSoldOut = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.rpc('toggle_sold_out', {
      item_id: id,
      new_status: !currentStatus
    });

    if (!error) {
      setMenuItems(menuItems.map(item => item.id === id ? { ...item, is_sold_out: !currentStatus } : item));
    } else {
      showAlert({
        title: 'Action Failed',
        message: `Failed to update sold out status: ${error.message}`,
        type: 'error'
      });
    }
  };

  const visibleMenuItems = menuItems.filter(item => item.canteen_id === selectedMenuCanteenId);

  return (
    <div className="w-full max-w-4xl grid grid-cols-12 gap-4">
      {/* Header */}
      <div className="col-span-12 bg-indigo-600 border border-indigo-500 rounded-[2rem] p-5 md:p-8 flex flex-col justify-between shadow-sm relative overflow-hidden text-white mb-4">
        <div className="z-10 flex justify-between items-start">
          <div>
            <span className="px-3 py-1 bg-indigo-500 text-indigo-100 text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-400">Admin Console</span>
            <h1 className="text-3xl font-extrabold text-white mt-4 leading-tight">Welcome, {profile?.name || 'Admin'}</h1>
          </div>
        </div>
      </div>

      {/* Daily Summary */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800">Today's Summary</h2>
          {/* Developer Toggle */}
          <div className="flex items-center gap-3 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100">
            <span className="text-sm font-semibold text-indigo-700">Devel: Ignore Ordering Time Limits</span>
            <button
              type="button"
              onClick={toggleDevIgnoreTime}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${devIgnoreTime ? 'bg-indigo-600' : 'bg-slate-200'}`}
              role="switch"
              aria-checked={devIgnoreTime}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${devIgnoreTime ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
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

      {/* Canteen Locations */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Canteen Locations</h2>
            <p className="text-sm text-slate-500 mt-1">
              Add locations students can order from and switch locations on or off.
            </p>
          </div>
          <span className="text-xs font-semibold px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full w-fit">
            {activeCanteens.length} active
          </span>
        </div>

        <form onSubmit={handleAddCanteen} className="grid grid-cols-1 sm:grid-cols-[1fr_12rem_auto] gap-3 mb-6">
          <input
            type="text"
            required
            placeholder="Location name (e.g. Engineering Cafeteria)"
            value={newCanteenName}
            onChange={(e) => setNewCanteenName(e.target.value)}
            maxLength={100}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
          />
          <input
            type="text"
            placeholder="Short code (optional)"
            value={newCanteenCode}
            onChange={(e) => setNewCanteenCode(e.target.value)}
            maxLength={20}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
          />
          <button
            type="submit"
            disabled={creatingCanteen || !currentTenantId}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {creatingCanteen ? 'Adding...' : 'Add Location'}
          </button>
        </form>

        {canteensLoading ? (
          <div className="text-slate-500 text-sm py-4">Loading locations...</div>
        ) : canteensError ? (
          <div className="text-sm text-red-600 py-4">
            {canteensError.message.includes("Could not find the table 'public.canteens'")
              ? 'The multi-location database migration has not been applied to this Supabase project yet. Apply supabase/migrations/0029_multi_canteen_support.sql in the Supabase SQL Editor, then reload this page.'
              : `Could not load locations: ${canteensError.message}`}
          </div>
        ) : canteens.length === 0 ? (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4">
            No locations found. Add a location above to start setting up multi-location ordering.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {canteens.map(canteen => (
              <div key={canteen.id} className="flex items-center justify-between gap-4 p-4 border border-slate-200 rounded-xl">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{canteen.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {canteen.code || 'No code'} · {canteen.is_active ? 'Available to students' : 'Hidden from students'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleCanteen(canteen)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    canteen.is_active
                      ? 'bg-red-50 text-red-700 hover:bg-red-100'
                      : 'bg-green-50 text-green-700 hover:bg-green-100'
                  }`}
                >
                  {canteen.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order List */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <h2 className="text-xl font-bold text-slate-800">Order List</h2>
          <div className="flex gap-2">
            {(['TODAY', 'WEEK', 'MONTH'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setOrderFilter(filter)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${orderFilter === filter
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                {filter === 'TODAY' ? "Today" : filter === 'WEEK' ? "Past Week" : "Past Month"}
              </button>
            ))}
          </div>
        </div>

        {ordersLoading ? (
          <div className="text-slate-500 text-sm">Loading orders...</div>
        ) : allOrders.length === 0 ? (
          <div className="text-slate-500 text-sm py-8 text-center bg-slate-50 rounded-2xl border border-slate-100">
            No orders found for this period.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
            {allOrders.map(order => (
              <div key={order.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col gap-3 hover:border-indigo-200 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-800">Order #{order.order_number}</h3>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">ID: {order.id.split('-')[0].toUpperCase()}</div>
                  </div>
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${order.status === 'COLLECTED' ? 'bg-green-100 text-green-700' :
                      order.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                    }`}>
                    {order.status}
                  </span>
                </div>

                <div className="text-sm text-slate-600">
                  <span className="font-semibold">{order.profiles?.name || 'Unknown'}</span> ({order.profiles?.id_number || 'No ID'})
                </div>

                <div className="text-xs text-slate-500">
                  Pickup: {formatPickupTime(order.pickup_time)} (Lunch) • {new Date(order.created_at).toLocaleDateString()}
                </div>

                <div className="mt-2 pt-3 border-t border-slate-200">
                  <ul className="space-y-1">
                    {order.order_items?.map((item: any) => (
                      <li key={item.id} className="text-xs text-slate-700">
                        <span className="font-semibold">{item.quantity}x</span> {item.menu_items?.name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Menu Management */}
      <div className="col-span-12 md:col-span-6 bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Manage Menu</h2>
        {/* Add Item Form */}
        <form onSubmit={handleAddItem} className="flex flex-col gap-3 mb-8 bg-slate-50 p-4 rounded-xl border border-slate-100">
          <select
            required
            value={selectedMenuCanteenId}
            onChange={(e) => setSelectedMenuCanteenId(e.target.value)}
            disabled={activeCanteens.length === 0}
            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800 disabled:bg-slate-100"
          >
            {activeCanteens.length === 0 ? (
              <option value="">Add an active location first</option>
            ) : (
              activeCanteens.map(canteen => (
                <option key={canteen.id} value={canteen.id}>{canteen.name}</option>
              ))
            )}
          </select>
          <input 
            type="text" 
            placeholder="Item Name" 
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            maxLength={100}
            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
          />
          <div className="flex gap-2 items-center">
            <input 
              type="number" 
              placeholder="Price (₹)" 
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(e.target.value)}
              min="0"
              step="any"
              className="w-28 px-3.5 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
            />
            <select 
              value={newItemType} 
              onChange={(e) => setNewItemType(e.target.value as FoodType)}
              className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
            >
              <option value="VEG">Veg</option>
              <option value="NON_VEG">Non-Veg</option>
            </select>
            <button 
              type="submit" 
              disabled={!selectedMenuCanteenId || activeCanteens.length === 0}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition-all shrink-0"
            >
              Add Item
            </button>
          </div>
        </form>

        {/* Menu List */}
        {loading && menuItems.length === 0 ? (
          <div className="text-slate-500 text-sm flex-1 min-h-[300px] flex items-center justify-center">Loading menu...</div>
        ) : (
          <div className="space-y-3 flex-1 overflow-y-auto min-h-[300px]">
            {visibleMenuItems.map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors shadow-sm gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${item.veg_non_veg === 'VEG' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${item.is_sold_out ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.name}</span>
                      {item.is_sold_out && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full shrink-0">Sold Out</span>}
                    </div>
                    <div className="text-xs font-bold text-slate-600 mt-0.5">₹{Number(item.price || 0).toFixed(2)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
                    className="text-[10px] sm:text-xs font-semibold text-slate-500 bg-slate-100 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {item.is_sold_out ? 'Mark Available' : 'Mark Sold Out'}
                  </button>
                </div>
              </div>
            ))}
            {visibleMenuItems.length === 0 && (
              <div className="text-slate-500 text-sm text-center py-4">
                {activeCanteens.length === 0 ? 'Add an active location to manage its menu.' : 'No menu items for this location yet.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Feedback & Reviews */}
      <div className="col-span-12 md:col-span-6 bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Student Feedback & Reviews</h2>

        {reviewsLoading ? (
          <div className="text-slate-500 text-sm">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="text-slate-500 text-sm py-4">No reviews yet.</div>
        ) : (
          <div className="flex flex-col gap-4 flex-1 overflow-y-auto min-h-[300px]">
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
                    <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                      <div className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">Your Reply</div>
                      <p className="text-sm text-slate-800">{review.admin_reply}</p>
                    </div>
                  ) : replyingTo === review.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a reply..."
                        maxLength={500}
                        className="w-full text-sm bg-white border border-indigo-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                          className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {submittingReply ? 'Sending...' : 'Send Reply'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setReplyingTo(review.id)}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
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
                          <span className="text-indigo-600">{item.count} sold</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200/50">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${idx === 0 ? 'bg-indigo-600' :
                                idx === 1 ? 'bg-indigo-500' :
                                  idx === 2 ? 'bg-indigo-400' : 'bg-indigo-300'
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

            <div className="bg-indigo-600 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-center text-white text-center">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"></path></svg>
              </div>
              <h3 className="font-bold text-xl mb-1">Great Job!</h3>
              <p className="text-indigo-200 text-sm">Keep up the good work managing orders.</p>
            </div>
          </div>
        )}
      </div>

      {/* Manage Staff Section */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm flex flex-col">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <h2 className="text-xl font-bold text-slate-800">Manage Staff</h2>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search users..."
              value={staffSearchText}
              onChange={(e) => setStaffSearchText(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none w-full sm:w-64"
            />
            <button
              onClick={() => setIsCreatingStaff(!isCreatingStaff)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition shrink-0"
            >
              + Add Staff
            </button>
          </div>
        </div>
        
        {isCreatingStaff && (
          <form onSubmit={handleCreateStaff} className="mb-6 bg-slate-50 p-6 rounded-2xl border border-slate-200">
            <h3 className="font-bold text-slate-800 mb-4">Create New Staff User</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <input
                type="text"
                required
                placeholder="Full Name"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                className="px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <input
                type="email"
                required
                placeholder="Email Address"
                value={newStaffEmail}
                onChange={(e) => setNewStaffEmail(e.target.value)}
                className="px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="Password (Min. 6 chars)"
                value={newStaffPassword}
                onChange={(e) => setNewStaffPassword(e.target.value)}
                className="px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreatingStaff(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingStaff}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {creatingStaff ? 'Creating...' : 'Create Staff'}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ID Number</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">Loading users...</td>
                </tr>
              ) : tenantUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">No users found.</td>
                </tr>
              ) : (
                tenantUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-bold text-slate-800">{u.name || 'Unnamed'}</td>
                    <td className="px-6 py-4 text-sm font-mono text-slate-600">{u.id_number || 'N/A'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                        u.role === 'STAFF' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleToggleStaffRole(u.id, u.role)}
                        className={`text-sm font-bold ${
                          u.role === 'STAFF' ? 'text-red-600 hover:text-red-800' : 'text-indigo-600 hover:text-indigo-800'
                        }`}
                      >
                        {u.role === 'STAFF' ? 'Demote to Student' : 'Promote to Staff'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
            <IconSparkles size={18} className="w-4.5 h-4.5 text-indigo-500 shrink-0" />
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
