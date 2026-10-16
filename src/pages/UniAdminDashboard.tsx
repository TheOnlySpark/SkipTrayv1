import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconStar } from '../components/Icons';
import { isValidEmail, formatErrorMessage } from '../utils/validation';
import { 
  Coffee, 
  Users, 
  BarChart3, 
  MessageSquare, 
  ArrowRight, 
  Building2, 
  ShieldCheck, 
  Plus, 
  Power, 
  Mail, 
  Key, 
  KeyRound,
  User,
  ChevronDown,
  Filter, 
  AlertCircle, 
  TrendingUp, 
  Sparkles, 
  Star,
  Search,
  Tag 
} from 'lucide-react';

type Canteen = Database['public']['Tables']['canteens']['Row'];

export default function UniAdminDashboard() {
  const location = useLocation();
  const isCanteensView = location.pathname === '/uni-admin/canteens' || location.search.includes('tab=canteens');
  const isAdminsView = location.pathname === '/uni-admin/admins' || location.search.includes('tab=admins');
  const isAnalyticsView = location.pathname === '/uni-admin/analytics' || location.search.includes('tab=analytics');
  const isReviewsView = location.pathname === '/uni-admin/reviews' || location.search.includes('tab=reviews');
  const isDedicatedView = isCanteensView || isAdminsView || isAnalyticsView || isReviewsView;

  const { profile } = useAuth();
  const { tenantId } = useTenant();
  const { showAlert, showConfirm } = useDialog();
  const queryClient = useQueryClient();

  const [newCanteenName, setNewCanteenName] = useState('');
  const [newCanteenCode, setNewCanteenCode] = useState('');
  const [creatingCanteen, setCreatingCanteen] = useState(false);

  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [selectedCanteenId, setSelectedCanteenId] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  const currentTenantId = profile?.tenant_id ?? tenantId ?? null;

  const [canteenSearch, setCanteenSearch] = useState('');
  const [canteenFilter, setCanteenFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const { data: canteens = [], isLoading: canteensLoading } = useQuery({
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

  const filteredCanteens = canteens.filter(c => {
    const query = canteenSearch.trim().toLowerCase();
    const matchesSearch = !query || c.name.toLowerCase().includes(query) || (c.code && c.code.toLowerCase().includes(query));
    if (!matchesSearch) return false;
    if (canteenFilter === 'ACTIVE') return c.is_active;
    if (canteenFilter === 'INACTIVE') return !c.is_active;
    return true;
  });

  const { data: canteenAdmins = [], isLoading: adminsLoading } = useQuery({
    queryKey: ['canteenAdmins', currentTenantId],
    enabled: !!currentTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, canteens(name)')
        .eq('tenant_id', currentTenantId)
        .eq('role', 'CANTEEN_ADMIN')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  useEffect(() => {
    if (canteens.length > 0 && !selectedCanteenId) {
      setSelectedCanteenId(canteens[0].id);
    }
  }, [canteens, selectedCanteenId]);

  const handleAddCanteen = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCanteenName.trim();
    if (!name) {
      showAlert({ title: 'Canteen Name Required', message: 'Please enter a name for the new canteen location.', type: 'warning' });
      return;
    }
    if (!currentTenantId) {
      showAlert({ title: 'Error', message: 'University organization context is missing.', type: 'error' });
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
      showAlert({ title: 'Error', message: formatErrorMessage(error, 'Failed to add canteen location.'), type: 'error' });
      return;
    }

    setNewCanteenName('');
    setNewCanteenCode('');
    await queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
    showAlert({ title: 'Location added', message: `${name} has been added.`, type: 'success' });
  };

  const handleToggleCanteen = async (canteen: Canteen) => {
    if (canteen.is_active) {
      const confirmed = await showConfirm({
        title: 'Deactivate Canteen',
        message: `Deactivate "${canteen.name}"? Students will not be able to place new orders for this canteen until it is reactivated.`,
        confirmText: 'Deactivate',
        cancelText: 'Keep Active',
        isDangerous: true,
      });
      if (!confirmed) return;
    }

    const { error } = await supabase
      .from('canteens')
      .update({ is_active: !canteen.is_active })
      .eq('id', canteen.id)
      .select('id, is_active')
      .maybeSingle();

    if (error) {
      showAlert({ title: 'Error', message: formatErrorMessage(error, 'Failed to change canteen status.'), type: 'error' });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
  };

  const handleCreateCanteenAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCanteenId) {
      showAlert({ title: 'Canteen Selection Required', message: 'Please select a canteen first before creating an admin.', type: 'warning' });
      return;
    }

    const trimmedName = newAdminName.trim();
    const trimmedEmail = newAdminEmail.trim();

    if (!trimmedName) {
      showAlert({ title: 'Admin Name Required', message: 'Please enter the admin\'s full name.', type: 'warning' });
      return;
    }

    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      showAlert({ title: 'Invalid Email Address', message: 'Please enter a valid email address for the canteen admin.', type: 'warning' });
      return;
    }

    if (!newAdminPassword || newAdminPassword.length < 6) {
      showAlert({ title: 'Password Too Short', message: 'Password must be at least 6 characters long.', type: 'warning' });
      return;
    }

    setCreatingAdmin(true);
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
          password: newAdminPassword,
          role: 'CANTEEN_ADMIN',
          canteen_id: selectedCanteenId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create admin');
      }

      showAlert({ title: 'Success', message: `Created canteen admin for ${trimmedEmail}`, type: 'success' });
      
      setNewAdminName('');
      setNewAdminEmail('');
      setNewAdminPassword('');
      queryClient.invalidateQueries({ queryKey: ['canteenAdmins', currentTenantId] });
    } catch (err: any) {
      showAlert({ title: 'Error', message: formatErrorMessage(err, 'Failed to create canteen admin.'), type: 'error' });
    } finally {
      setCreatingAdmin(false);
    }
  };

  // --- NEW MODULES: FEEDBACK & REVIEWS and ANALYTICS ---

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [reviewCanteenFilter, setReviewCanteenFilter] = useState<string>('ALL');

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['uniAdminReviews', currentTenantId, reviewCanteenFilter],
    enabled: !!currentTenantId,
    queryFn: async () => {
      let query = supabase
        .from('item_reviews')
        .select(`
          *,
          menu_items!inner (name, canteen_id, tenant_id, canteens(name)),
          profiles (name, id_number),
          orders (id, order_number)
        `)
        .eq('menu_items.tenant_id', currentTenantId)
        .order('created_at', { ascending: false });

      if (reviewCanteenFilter !== 'ALL') {
         query = query.eq('menu_items.canteen_id', reviewCanteenFilter);
      }
      
      const { data, error } = await query;
      if (error) console.error("Error fetching reviews:", error);
      return (data as any[]) || [];
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
      queryClient.invalidateQueries({ queryKey: ['uniAdminReviews'] });
      showAlert({ title: 'Reply Published', message: 'Reply submitted successfully.', type: 'success' });
    }
    setSubmittingReply(false);
  };

  const [analyticsCanteenFilter, setAnalyticsCanteenFilter] = useState<string>('ALL');
  const { data: analytics = { mostSold: [] }, isLoading: analyticsLoading } = useQuery({
    queryKey: ['uniAdminAnalytics', currentTenantId, analyticsCanteenFilter],
    enabled: !!currentTenantId,
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      let query = supabase
        .from('orders')
        .select(`
          status,
          order_items (
            quantity,
            menu_items (name)
          )
        `)
        .eq('tenant_id', currentTenantId)
        .gte('created_at', startDate.toISOString())
        .neq('status', 'REJECTED');

      if (analyticsCanteenFilter !== 'ALL') {
        query = query.eq('canteen_id', analyticsCanteenFilter);
      }

      const { data } = await query;
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

  return (
    <div className={`w-full ${isDedicatedView ? 'max-w-3xl my-auto py-2' : 'max-w-4xl'} mx-auto grid grid-cols-1 gap-4`}>
      {isCanteensView ? (
        /* Dedicated Manage Canteens View */
        <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-xl shadow-indigo-500/5 hover:shadow-indigo-500/10 transition-all duration-300">
          {/* Top ambient accent glow */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-t-3xl" />
          <div className="absolute -top-20 -right-20 w-56 h-56 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header Section */}
          <div className="flex flex-col items-center text-center mb-4 relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/25 mb-2 ring-4 ring-indigo-50/70">
              <Coffee size={28} strokeWidth={2.2} />
            </div>
            <h1 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Manage Canteens</h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-0.5 leading-snug">
              Register cafeteria locations, configure short codes, and control operational status for students.
            </p>

            {/* Metric Badges Row */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {canteens.filter(c => c.is_active).length} Active
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200/70 shadow-xs">
                {canteens.filter(c => !c.is_active).length} Inactive
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/70 shadow-xs">
                <Building2 size={13} />
                {canteens.length} Location{canteens.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Add New Canteen Form Surface */}
          <div className="bg-slate-50/75 border border-slate-200/80 rounded-2xl p-3.5 sm:p-4 mb-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Plus size={13} strokeWidth={2.5} className="text-indigo-600" />
                <span className="font-extrabold text-[11px] text-slate-700 uppercase tracking-wider">
                  Register New Canteen Location
                </span>
              </div>
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                Quick Setup
              </span>
            </div>

            <form onSubmit={handleAddCanteen} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-7 relative">
                <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="Canteen Name (e.g. Science Block)"
                  value={newCanteenName}
                  onChange={e => setNewCanteenName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs sm:text-sm shadow-xs placeholder:text-slate-400"
                />
              </div>

              <div className="sm:col-span-3 relative">
                <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="SHORT CODE"
                  value={newCanteenCode}
                  onChange={e => setNewCanteenCode(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs sm:text-sm uppercase font-mono tracking-wider text-center shadow-xs placeholder:text-slate-400"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={creatingCanteen || !currentTenantId}
                  className="w-full h-[40px] bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-sm shadow-indigo-600/20 hover:shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer active:scale-95"
                >
                  <Plus size={14} strokeWidth={2.5} />
                  <span>{creatingCanteen ? 'Adding...' : 'Add'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Registered Canteens List */}
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-1.5">
                <Building2 size={15} className="text-indigo-600" />
                <h3 className="font-extrabold text-slate-800 text-xs sm:text-sm tracking-tight">
                  Registered Facilities
                </h3>
                <span className="px-2 py-0.2 rounded-full text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                  {filteredCanteens.length}
                </span>
              </div>

              {canteens.length > 0 && (
                <div className="flex items-center gap-1.5 w-full sm:w-auto">
                  {/* Search input */}
                  <div className="relative flex-1 sm:w-40">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={canteenSearch}
                      onChange={e => setCanteenSearch(e.target.value)}
                      className="w-full pl-7 pr-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  {/* Filter pill tabs */}
                  <div className="flex bg-slate-100 p-0.5 rounded-lg text-[10px] font-semibold text-slate-600 shrink-0">
                    <button
                      type="button"
                      onClick={() => setCanteenFilter('ALL')}
                      className={`px-2 py-0.5 rounded-md transition cursor-pointer ${canteenFilter === 'ALL' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'hover:text-slate-900'}`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setCanteenFilter('ACTIVE')}
                      className={`px-2 py-0.5 rounded-md transition cursor-pointer ${canteenFilter === 'ACTIVE' ? 'bg-white text-emerald-700 shadow-xs font-bold' : 'hover:text-slate-900'}`}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      onClick={() => setCanteenFilter('INACTIVE')}
                      className={`px-2 py-0.5 rounded-md transition cursor-pointer ${canteenFilter === 'INACTIVE' ? 'bg-white text-slate-700 shadow-xs font-bold' : 'hover:text-slate-900'}`}
                    >
                      Inactive
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canteensLoading ? (
              <div className="text-slate-400 text-xs py-6 text-center animate-pulse">Loading dining facilities...</div>
            ) : canteens.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-50 p-6 rounded-2xl text-center border border-slate-200/80 flex flex-col items-center justify-center gap-1.5">
                <Building2 size={28} className="text-slate-300" />
                <p className="font-bold text-slate-700 text-sm">No canteens registered yet</p>
                <p className="text-[11px] text-slate-400 max-w-xs">Use the quick form above to create your campus cafeteria location.</p>
              </div>
            ) : filteredCanteens.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-xl text-center border border-slate-200/80">
                No facilities matching "{canteenSearch}".
              </div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2">
                {filteredCanteens.map(canteen => (
                  <div
                    key={canteen.id}
                    className="group flex items-center justify-between p-2.5 sm:p-3 border border-slate-200/80 rounded-xl bg-gradient-to-r from-white via-slate-50/40 to-indigo-50/20 hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/5 transition-all gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-xs transition-transform group-hover:scale-105 ${
                        canteen.is_active
                          ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-emerald-500/20'
                          : 'bg-slate-200 text-slate-500'
                      }`}>
                        <Coffee size={17} />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-slate-900 text-sm tracking-tight truncate group-hover:text-indigo-600 transition-colors">
                            {canteen.name}
                          </h4>
                          <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[10px] border border-slate-200/80">
                            {canteen.code || 'NO-CODE'}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${canteen.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                          <span className={canteen.is_active ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
                            {canteen.is_active ? 'Operational • Taking Orders' : 'Offline / Closed'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleToggleCanteen(canteen)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 ${
                          canteen.is_active
                            ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 border border-rose-200/80'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 border border-emerald-200/80'
                        }`}
                      >
                        <Power size={12} strokeWidth={2.2} />
                        <span>{canteen.is_active ? 'Deactivate' : 'Activate'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : isAdminsView ? (
        /* Dedicated Canteen Admins View */
        <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-xl shadow-violet-500/5 hover:shadow-violet-500/10 transition-all duration-300">
          {/* Top ambient accent glow */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500 rounded-t-3xl" />
          <div className="absolute -top-20 -right-20 w-56 h-56 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header Section */}
          <div className="flex flex-col items-center text-center mb-4 relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-violet-500/25 mb-2 ring-4 ring-violet-50">
              <Users size={28} />
            </div>
            <h1 className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">Create & Manage Admins</h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-0.5 leading-snug">
              Provision administrator credentials and assign kitchen managers to individual cafeterias.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-violet-50 text-violet-700 border border-violet-200/80 shadow-xs">
                <ShieldCheck size={14} />
                {canteenAdmins.length} Active Administrator{canteenAdmins.length === 1 ? '' : 's'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-xs">
                <Building2 size={13} />
                {canteens.length} Canteen{canteens.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Create Canteen Admin Form Surface */}
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3.5 sm:p-4 mb-4 shadow-xs">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                <Plus size={13} strokeWidth={2.5} className="text-violet-600" />
                <span>Create Canteen Administrator</span>
              </div>
              <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-100">
                Staff Credentials
              </span>
            </div>

            <form onSubmit={handleCreateCanteenAdmin} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              {canteens.length === 0 ? (
                <div className="sm:col-span-12 text-xs text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={15} className="text-amber-600 shrink-0" />
                    <span>No canteens available yet. Create a canteen first before adding administrators.</span>
                  </div>
                  <Link to="/uni-admin/canteens" className="px-2.5 py-1 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 shrink-0 transition inline-flex items-center gap-1">
                    <span>Add Canteen</span>
                    <ArrowRight size={13} />
                  </Link>
                </div>
              ) : (
                <>
                  <div className="sm:col-span-6">
                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                      Assign Cafeteria
                    </label>
                    <div className="relative">
                      <Coffee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <select
                        required
                        value={selectedCanteenId}
                        onChange={e => setSelectedCanteenId(e.target.value)}
                        className="w-full pl-8.5 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none shadow-xs transition appearance-none cursor-pointer"
                      >
                        {canteens.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <div className="sm:col-span-6">
                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                      Admin Full Name
                    </label>
                    <div className="relative">
                      <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. John Doe"
                        value={newAdminName}
                        onChange={e => setNewAdminName(e.target.value)}
                        className="w-full pl-8.5 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none shadow-xs transition"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="email"
                        required
                        placeholder="admin@cafeteria.edu"
                        value={newAdminEmail}
                        onChange={e => setNewAdminEmail(e.target.value)}
                        className="w-full pl-8.5 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none shadow-xs transition"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                      Initial Password
                    </label>
                    <div className="relative">
                      <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={newAdminPassword}
                        onChange={e => setNewAdminPassword(e.target.value)}
                        className="w-full pl-8.5 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none shadow-xs transition"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-3 flex items-end">
                    <button
                      type="submit"
                      disabled={creatingAdmin || !selectedCanteenId || canteens.length === 0}
                      className="w-full h-[36px] bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm shadow-violet-600/20 hover:shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer active:scale-95"
                    >
                      <Plus size={14} strokeWidth={2.5} />
                      <span>{creatingAdmin ? 'Creating...' : 'Create Admin'}</span>
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>

          {/* Existing Canteen Admins List */}
          <div>
            <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-violet-600" />
                <h3 className="font-extrabold text-slate-800 text-xs sm:text-sm tracking-tight">
                  Existing Canteen Admins
                </h3>
                <span className="px-2 py-0.2 rounded-full text-[11px] font-black bg-violet-50 text-violet-700 border border-violet-200/70">
                  {canteenAdmins.length}
                </span>
              </div>
            </div>

            {adminsLoading ? (
              <div className="text-slate-400 text-xs py-6 text-center animate-pulse">Loading admins...</div>
            ) : canteenAdmins.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-50 p-6 rounded-2xl text-center border border-slate-200/80 flex flex-col items-center justify-center gap-1.5">
                <Users size={28} className="text-slate-300" />
                <p className="font-bold text-slate-700 text-sm">No canteen admins registered yet</p>
                <p className="text-[11px] text-slate-400 max-w-xs">Use the form above to add an administrator for your cafeterias.</p>
              </div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2">
                {canteenAdmins.map((admin: any) => (
                  <div
                    key={admin.id}
                    className="group flex items-center justify-between p-2.5 sm:p-3 border border-slate-200/80 rounded-xl bg-gradient-to-r from-white via-slate-50/40 to-violet-50/20 hover:border-violet-300 hover:shadow-md hover:shadow-violet-500/5 transition-all gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white font-extrabold text-xs flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform">
                        {admin.name?.charAt(0)?.toUpperCase() || 'A'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-extrabold text-slate-900 text-sm tracking-tight truncate group-hover:text-violet-700 transition-colors">
                          {admin.name}
                        </div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                          <span className="font-medium text-slate-600 flex items-center gap-1">
                            <Mail size={11} className="text-slate-400" />
                            {admin.email || 'Admin'}
                          </span>
                          <span>•</span>
                          <span className="px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 font-bold border border-indigo-200/60 text-[10px] flex items-center gap-1">
                            <Coffee size={10} />
                            {admin.canteens?.name || 'Unassigned'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/70 flex items-center gap-1 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : isAnalyticsView ? (
        /* Dedicated Weekly Analytics View */
        <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-[2.5rem] p-7 sm:p-10 shadow-2xl shadow-purple-500/5 hover:shadow-purple-500/10 transition-all duration-300 flex flex-col">
          {/* Top ambient accent glow */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 rounded-t-[2.5rem]" />
          <div className="absolute -top-24 -right-24 w-72 h-72 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-pink-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header Section */}
          <div className="flex flex-col items-center text-center mb-8 relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 text-white flex items-center justify-center shadow-lg shadow-purple-500/25 mb-4 ring-4 ring-purple-50 group-hover:scale-105 transition-transform">
              <BarChart3 size={30} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Weekly Analytics</h1>
            <p className="text-sm text-slate-500 max-w-md mt-1.5 leading-relaxed">
              Live operational analytics, demand metrics, and top sold cafeteria items.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 border border-slate-200/80 text-xs font-semibold text-slate-700 shadow-xs">
                <Filter size={13} className="text-slate-500" />
                <span>Filter Canteen:</span>
                <select
                  value={analyticsCanteenFilter}
                  onChange={e => setAnalyticsCanteenFilter(e.target.value)}
                  className="bg-transparent font-bold text-purple-700 outline-none cursor-pointer"
                >
                  <option value="ALL">All Canteens</option>
                  {canteens.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {analyticsLoading ? (
            <div className="text-slate-400 text-sm py-16 text-center animate-pulse">Loading analytics data...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Most Sold This Week */}
              <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-200/60">
                    <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingUp size={15} className="text-purple-600" />
                      <span>Most Sold This Week</span>
                    </h3>
                    <span className="text-[11px] font-semibold text-slate-500">Past 7 Days</span>
                  </div>

                  {analytics.mostSold.length === 0 ? (
                    <div className="text-slate-400 text-sm py-8 text-center">No item sales recorded this week.</div>
                  ) : (
                    <div className="space-y-4">
                      {analytics.mostSold.map((item, idx) => {
                        const maxCount = Math.max(...analytics.mostSold.map(i => i.count), 1);
                        const percentage = Math.round((item.count / maxCount) * 100);
                        return (
                          <div key={idx} className="flex flex-col gap-1.5">
                            <div className="flex justify-between text-xs font-semibold">
                              <span className="text-slate-800 flex items-center gap-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                                  idx === 0 ? 'bg-amber-100 text-amber-700 border border-amber-300' :
                                  idx === 1 ? 'bg-slate-200 text-slate-700 border border-slate-300' :
                                  idx === 2 ? 'bg-amber-700/20 text-amber-800 border border-amber-700/30' :
                                  'bg-slate-100 text-slate-500 border border-slate-200'
                                }`}>
                                  {idx + 1}
                                </span>
                                <span className="truncate max-w-[160px] sm:max-w-[200px]">{item.name}</span>
                              </span>
                              <span className="text-purple-700 font-bold">{item.count} orders</span>
                            </div>
                            <div className="w-full bg-slate-200/60 rounded-full h-2.5 overflow-hidden">
                              <div
                                className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${
                                  idx === 0 ? 'bg-gradient-to-r from-purple-600 to-pink-500' :
                                  idx === 1 ? 'bg-gradient-to-r from-purple-500 to-indigo-500' :
                                  idx === 2 ? 'bg-gradient-to-r from-indigo-500 to-blue-500' :
                                  'bg-slate-400'
                                }`}
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

              {/* High-Contrast Operations Pulse Card */}
              <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 rounded-2xl p-6 text-white shadow-lg border border-indigo-900/40 flex flex-col justify-between">
                <div className="absolute -top-12 -right-12 w-40 h-40 bg-purple-500/20 rounded-full blur-2xl pointer-events-none" />
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-purple-200 border border-white/10 text-[11px] font-bold uppercase tracking-wider mb-4">
                    <Sparkles size={12} className="text-yellow-400" />
                    Kitchen Pulse
                  </div>
                  <h3 className="text-xl font-extrabold tracking-tight mb-2">Demand Overview</h3>
                  <p className="text-indigo-200/80 text-xs leading-relaxed mb-6">
                    Weekly cafeteria volume tracked across campus. Real-time items prepared and student pre-orders fulfilled.
                  </p>
                </div>

                <div className="pt-4 border-t border-white/10 flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-black tracking-tight text-white">
                      {analytics.mostSold.reduce((acc, i) => acc + i.count, 0)}
                    </div>
                    <div className="text-[11px] font-medium text-purple-300 mt-0.5">Total Top Items Sold</div>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white border border-white/10">
                    <BarChart3 size={24} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : isReviewsView ? (
        /* Dedicated Student Feedback & Reviews View */
        <div className="relative overflow-hidden bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-[2.5rem] p-7 sm:p-10 shadow-2xl shadow-emerald-500/5 hover:shadow-emerald-500/10 transition-all duration-300 flex flex-col">
          {/* Top ambient accent glow */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 rounded-t-[2.5rem]" />
          <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header Section */}
          <div className="flex flex-col items-center text-center mb-8 relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-4 ring-4 ring-emerald-50 group-hover:scale-105 transition-transform">
              <MessageSquare size={30} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Student Feedback & Reviews</h1>
            <p className="text-sm text-slate-500 max-w-md mt-1.5 leading-relaxed">
              Monitor student satisfaction, dining remarks, and respond directly to kitchen feedback.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-xs">
                <Star size={13} className="text-yellow-500 fill-yellow-500" />
                {reviews.length} Total Review{reviews.length === 1 ? '' : 's'}
              </span>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 border border-slate-200/80 text-xs font-semibold text-slate-700 shadow-xs">
                <Filter size={13} className="text-slate-500" />
                <span>Filter Canteen:</span>
                <select
                  value={reviewCanteenFilter}
                  onChange={e => setReviewCanteenFilter(e.target.value)}
                  className="bg-transparent font-bold text-emerald-700 outline-none cursor-pointer"
                >
                  <option value="ALL">All Canteens</option>
                  {canteens.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {reviewsLoading ? (
            <div className="text-slate-400 text-sm py-16 text-center animate-pulse">Loading student reviews...</div>
          ) : reviews.length === 0 ? (
            <div className="text-sm text-slate-500 bg-slate-50 p-10 rounded-2xl text-center border border-slate-200/80 flex flex-col items-center justify-center gap-2.5">
              <MessageSquare size={36} className="text-slate-300" />
              <p className="font-bold text-slate-700 text-base">No reviews recorded yet</p>
              <p className="text-xs text-slate-400 max-w-xs">When students submit order ratings and dining remarks, they will appear here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 flex-1 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {reviews.map(review => (
                <div key={review.id} className="p-5 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/50 hover:to-emerald-50/20 hover:border-emerald-200 hover:shadow-md transition-all duration-200 flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-100 to-teal-100 text-emerald-700 border border-emerald-200/60 flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                        {review.profiles?.name?.charAt(0)?.toUpperCase() || 'S'}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm">
                          {review.orders?.order_number ? `Order #${review.orders.order_number} — ` : ''}
                          <span className="text-indigo-600">{review.menu_items?.name || 'Unknown Item'}</span>
                        </h3>
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                          {review.menu_items?.canteens?.name && (
                            <span className="font-semibold text-slate-700 flex items-center gap-1">
                              <Coffee size={11} className="text-slate-400" />
                              {review.menu_items.canteens.name}
                            </span>
                          )}
                          <span>•</span>
                          <span>By {review.profiles?.name || 'Anonymous Student'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 self-start sm:self-center bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200/60">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <IconStar
                          key={i}
                          size={15}
                          className={`w-3.5 h-3.5 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`}
                          filled={i < review.rating}
                        />
                      ))}
                    </div>
                  </div>

                  {review.feedback_text && (
                    <div className="bg-slate-50/90 p-3.5 rounded-xl border border-slate-200/60 text-sm text-slate-700 italic relative">
                      "{review.feedback_text}"
                    </div>
                  )}

                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Reviewed on {new Date(review.created_at).toLocaleDateString()}</span>
                  </div>

                  {/* Admin Reply Section */}
                  <div className="pt-3 border-t border-slate-200/70">
                    {review.admin_reply ? (
                      <div className="bg-emerald-50/80 p-3.5 rounded-xl border border-emerald-200/70">
                        <div className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <ShieldCheck size={14} className="text-emerald-600" />
                          <span>Campus Admin Response</span>
                        </div>
                        <p className="text-sm text-slate-800">{review.admin_reply}</p>
                      </div>
                    ) : replyingTo === review.id ? (
                      <div className="flex flex-col gap-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write a response to this student feedback..."
                          maxLength={500}
                          className="w-full text-sm bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-xs"
                          rows={2}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => { setReplyingTo(null); setReplyText(''); }}
                            className="px-3.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleReplyToReview(review.id)}
                            disabled={submittingReply || !replyText.trim()}
                            className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg text-xs font-bold hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 transition shadow-xs cursor-pointer"
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
      ) : (
        /* Executive Campus Overview Hub */
        <>
          <div className="bg-indigo-600 rounded-[2rem] p-8 text-white shadow-sm">
            <span className="px-3 py-1 bg-indigo-500 text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-400">
              University Admin
            </span>
            <h1 className="text-3xl font-extrabold mt-4 leading-tight">Welcome, {profile?.name || 'Admin'}</h1>
            <p className="mt-2 text-indigo-100 max-w-2xl text-sm leading-relaxed">
              Executive campus dining management. Select any module from the navigation sidebar or quick cards below to manage operations.
            </p>
          </div>

          {/* 4 Interactive Hub Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Card 1: Manage Canteens */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4 border border-amber-200/60">
                  <Coffee size={24} />
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-extrabold text-slate-800 text-lg">Manage Canteens</h3>
                  <span className="text-2xl font-black text-slate-900">{canteens.length}</span>
                </div>
                <p className="text-slate-500 text-xs mb-4">
                  {canteens.filter(c => c.is_active).length} active operational cafeteria terminals on campus.
                </p>
              </div>
              <Link
                to="/uni-admin/canteens"
                className="w-full py-2.5 px-4 bg-slate-50 hover:bg-indigo-50 text-indigo-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-indigo-200 transition"
              >
                <span>Configure Canteens</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            {/* Card 2: Canteen Admins */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center mb-4 border border-indigo-200/60">
                  <Users size={24} />
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-extrabold text-slate-800 text-lg">Canteen Admins</h3>
                  <span className="text-2xl font-black text-slate-900">{canteenAdmins.length}</span>
                </div>
                <p className="text-slate-500 text-xs mb-4">
                  Kitchen managers assigned to coordinate orders and staff across canteens.
                </p>
              </div>
              <Link
                to="/uni-admin/admins"
                className="w-full py-2.5 px-4 bg-slate-50 hover:bg-indigo-50 text-indigo-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-indigo-200 transition"
              >
                <span>Manage Administrators</span>
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
                    ? `Top item: "${analytics.mostSold[0]?.name}" (${analytics.mostSold[0]?.count} sold)`
                    : 'Track sales volume and kitchen demand trends.'}
                </p>
              </div>
              <Link
                to="/uni-admin/analytics"
                className="w-full py-2.5 px-4 bg-slate-50 hover:bg-indigo-50 text-indigo-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-indigo-200 transition"
              >
                <span>View Analytics</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            {/* Card 4: Student Feedback */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex flex-col justify-between hover:shadow-md transition">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4 border border-emerald-200/60">
                  <MessageSquare size={24} />
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-extrabold text-slate-800 text-lg">Feedback & Reviews</h3>
                  <span className="text-2xl font-black text-slate-900">{reviews.length}</span>
                </div>
                <p className="text-slate-500 text-xs mb-4">
                  Student ratings and quality comments across all campus canteens.
                </p>
              </div>
              <Link
                to="/uni-admin/reviews"
                className="w-full py-2.5 px-4 bg-slate-50 hover:bg-indigo-50 text-indigo-600 font-bold text-xs rounded-xl flex items-center justify-between border border-slate-200/80 hover:border-indigo-200 transition"
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
