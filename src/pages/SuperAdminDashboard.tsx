import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { Building, Plus, Users, Search, AlertCircle, CheckCircle, Store, ShoppingBag } from 'lucide-react';
import { isValidEmail, formatErrorMessage } from '../utils/validation';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  created_at: string;
  tenant_settings?: {
    display_name?: string;
  };
}

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const { showConfirm, showAlert } = useDialog();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create form state
  const [isCreating, setIsCreating] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit form state
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Analytics
  const [totalTenants, setTotalTenants] = useState(0);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tenants')
        .select(`
          *,
          tenant_settings (
            display_name
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setTenants(data as any || []);
      setTotalTenants(data?.length || 0);
    } catch (err: any) {
      console.error('Error fetching tenants:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (tenantId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase.rpc('admin_toggle_tenant', {
        p_tenant_id: tenantId,
        p_is_active: !currentStatus
      });

      if (error) throw error;
      
      setSuccess(`Tenant ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      fetchTenants();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
      setTimeout(() => setError(''), 5000);
    }
  };

  const startEditing = (tenant: Tenant) => {
    setEditingTenantId(tenant.id);
    setEditName(tenant.name);
    setEditSlug(tenant.slug);
  };

  const cancelEditing = () => {
    setEditingTenantId(null);
    setEditName('');
    setEditSlug('');
  };

  const handleSaveEdit = async (tenantId: string) => {
    try {
      setSavingEdit(true);
      setError('');
      
      const { error: tenantError } = await supabase
        .from('tenants')
        .update({ name: editName, slug: editSlug })
        .eq('id', tenantId);

      if (tenantError) throw tenantError;

      // Also update the display_name in tenant_settings so it reflects in the UI
      const { error: settingsError } = await supabase
        .from('tenant_settings')
        .update({ display_name: editName })
        .eq('tenant_id', tenantId);

      if (settingsError) {
        console.error('Failed to update tenant_settings:', settingsError);
      }

      setSuccess('Tenant updated successfully');
      setEditingTenantId(null);
      fetchTenants();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
      setTimeout(() => setError(''), 5000);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const trimmedName = newName.trim();
    const trimmedSlug = newSlug.trim().toLowerCase();
    const trimmedAdminName = adminName.trim();
    const trimmedAdminEmail = adminEmail.trim();

    if (!trimmedName) {
      setError('Please enter the organization name.');
      return;
    }

    if (!trimmedSlug || !/^[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]$/.test(trimmedSlug)) {
      setError('Subdomain slug must be 3–40 characters and contain only lowercase letters, numbers, and hyphens (cannot start or end with a hyphen).');
      return;
    }

    if (!trimmedAdminName) {
      setError('Please enter the administrator\'s full name.');
      return;
    }

    if (!trimmedAdminEmail || !isValidEmail(trimmedAdminEmail)) {
      setError('Please enter a valid email address for the administrator.');
      return;
    }

    if (!adminPassword || adminPassword.length < 6) {
      setError('Administrator password must be at least 6 characters long.');
      return;
    }

    setCreating(true);

    try {
      const functionsUrl = import.meta.env.VITE_SUPABASE_URL
        ? `${import.meta.env.VITE_SUPABASE_URL.replace('/rest/v1', '')}/functions/v1`
        : 'http://localhost:54321/functions/v1';

      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(`${functionsUrl}/create-tenant-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          slug: trimmedSlug,
          name: trimmedName,
          admin_name: trimmedAdminName,
          admin_email: trimmedAdminEmail,
          admin_password: adminPassword
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create tenant');
      }

      setSuccess(`Tenant "${trimmedName}" created successfully! Admin credentials sent to ${trimmedAdminEmail}`);
      setIsCreating(false);
      
      // Reset form
      setNewSlug('');
      setNewName('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
      
      fetchTenants();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      console.error('Create tenant error:', err);
      setError(formatErrorMessage(err, 'Failed to provision tenant organization. Please check details and try again.'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTenant = async (tenantId: string, tenantName: string) => {
    const confirmed = await showConfirm({
      title: 'Delete Tenant Permanently',
      message: `Permanently delete "${tenantName}" and ALL of its associated users, orders, canteens, and menu items?\n\nThis action cannot be undone.`,
      confirmText: 'Delete Tenant',
      cancelText: 'Cancel',
      isDangerous: true,
    });
    if (!confirmed) return;

    try {
      setError('');
      const { data, error } = await supabase.rpc('admin_delete_tenant_cascade', {
        p_tenant_id: tenantId
      });

      if (error) throw error;
      
      setSuccess(`Tenant "${tenantName}" deleted successfully`);
      fetchTenants();
      showAlert({ title: 'Tenant Deleted', message: `"${tenantName}" has been permanently deleted.`, type: 'success' });
    } catch (err: any) {
      console.error('Delete tenant error:', err);
      setError(err.message);
      showAlert({ title: 'Delete Failed', message: err.message, type: 'error' });
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Super Admin Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Platform management and tenant overview</p>
        </div>
        <button
          onClick={() => setIsCreating(!isCreating)}
          className="flex items-center gap-2 px-4 py-2 bg-[#1d68f2] hover:bg-[#1656cb] text-white rounded-xl text-sm font-bold shadow-md shadow-blue-500/20 transition cursor-pointer"
        >
          {isCreating ? <Building size={16} /> : <Plus size={16} />}
          {isCreating ? 'View Tenants' : 'Create Tenant'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-center gap-3">
          <AlertCircle size={20} />
          <span className="font-medium text-sm">{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 text-green-700 rounded-xl border border-green-100 flex items-center gap-3">
          <CheckCircle size={20} />
          <span className="font-medium text-sm">{success}</span>
        </div>
      )}

      {/* 4 Metric Cards Exactly Matching Prototype 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Tenants */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Tenants</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{totalTenants || 12}</div>
            <div className="text-[11px] font-bold text-emerald-600 mt-1 flex items-center gap-1">
              <span>↑ 2 new this month</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#1d68f2] flex items-center justify-center shrink-0 border border-blue-100">
            <Store size={22} />
          </div>
        </div>

        {/* Metric 2: Total Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Revenue</span>
            <div className="text-2xl font-black text-slate-900 mt-1">₹ 12,48,320</div>
            <div className="text-[11px] font-bold text-emerald-600 mt-1 flex items-center gap-1">
              <span>↑ 18% from last month</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            <span className="font-black text-lg">₹</span>
          </div>
        </div>

        {/* Metric 3: Active Cafeterias */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Active Cafeterias</span>
            <div className="text-2xl font-black text-slate-900 mt-1">36</div>
            <div className="text-[11px] font-bold text-emerald-600 mt-1 flex items-center gap-1">
              <span>↑ 4 new this month</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center shrink-0 border border-cyan-100">
            <Building size={22} />
          </div>
        </div>

        {/* Metric 4: Total Orders */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Orders</span>
            <div className="text-2xl font-black text-slate-900 mt-1">48,532</div>
            <div className="text-[11px] font-bold text-emerald-600 mt-1 flex items-center gap-1">
              <span>↑ 12% from last month</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
            <ShoppingBag size={22} />
          </div>
        </div>
      </div>

      {/* Row 2: Revenue Overview Chart + Tenant Distribution + Recent Tenants */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Revenue Overview Line Curve */}
        <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-extrabold text-slate-800">Revenue Overview</h3>
              <p className="text-xs text-slate-400">Past 14 days financial collection</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Revenue</span>
              <span className="text-base font-black text-[#1d68f2]">₹ 12,48,320</span>
            </div>
          </div>

          {/* SVG Smooth Line Chart matching image */}
          <div className="w-full h-44 relative mt-2">
            <svg viewBox="0 0 500 160" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1d68f2" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#1d68f2" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Horizontal Grid lines */}
              <line x1="0" y1="20" x2="500" y2="20" stroke="#f1f5f9" strokeWidth="1" />
              <line x1="0" y1="60" x2="500" y2="60" stroke="#f1f5f9" strokeWidth="1" />
              <line x1="0" y1="100" x2="500" y2="100" stroke="#f1f5f9" strokeWidth="1" />
              <line x1="0" y1="140" x2="500" y2="140" stroke="#f1f5f9" strokeWidth="1" />

              {/* Smooth Area */}
              <path
                d="M 10 110 C 60 115, 90 95, 130 90 C 180 85, 210 50, 260 70 C 310 90, 360 40, 410 75 C 440 95, 470 50, 490 55 L 490 140 L 10 140 Z"
                fill="url(#revenueGrad)"
              />
              {/* Stroke Line */}
              <path
                d="M 10 110 C 60 115, 90 95, 130 90 C 180 85, 210 50, 260 70 C 310 90, 360 40, 410 75 C 440 95, 470 50, 490 55"
                fill="none"
                stroke="#1d68f2"
                strokeWidth="3"
                strokeLinecap="round"
              />
              {/* Points */}
              <circle cx="130" cy="90" r="4" fill="#ffffff" stroke="#1d68f2" strokeWidth="2.5" />
              <circle cx="260" cy="70" r="4" fill="#ffffff" stroke="#1d68f2" strokeWidth="2.5" />
              <circle cx="410" cy="75" r="4" fill="#ffffff" stroke="#1d68f2" strokeWidth="2.5" />
              <circle cx="490" cy="55" r="4" fill="#1d68f2" stroke="#ffffff" strokeWidth="2" />
            </svg>
            <div className="flex justify-between text-[10px] font-semibold text-slate-400 mt-1">
              <span>Oct 1</span>
              <span>Oct 3</span>
              <span>Oct 5</span>
              <span>Oct 7</span>
              <span>Oct 9</span>
              <span>Oct 11</span>
              <span>Oct 13</span>
              <span>Oct 14</span>
            </div>
          </div>
        </div>

        {/* Tenant Distribution Donut Chart */}
        <div className="lg:col-span-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">Tenant Distribution</h3>
            <p className="text-[11px] text-slate-400">By enrolled campuses</p>
          </div>

          <div className="flex items-center justify-center my-3 relative">
            <div className="w-28 h-28 rounded-full border-[10px] border-[#1d68f2] border-t-emerald-500 border-r-cyan-400 border-b-purple-500 flex flex-col items-center justify-center shadow-inner">
              <span className="text-xl font-black text-slate-800 leading-none">{totalTenants || 12}</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Tenants</span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-[#1d68f2]" />
                Vels University
              </span>
              <span className="font-bold text-slate-800">4</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                SRM University
              </span>
              <span className="font-bold text-slate-800">3</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Anna University
              </span>
              <span className="font-bold text-slate-800">2</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                PSG College
              </span>
              <span className="font-bold text-slate-800">2</span>
            </div>
          </div>
        </div>

        {/* Recent Tenants List */}
        <div className="lg:col-span-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-extrabold text-slate-800">Recent Tenants</h3>
            <span className="text-[11px] font-bold text-[#1d68f2] hover:underline cursor-pointer">View all</span>
          </div>

          <div className="space-y-2.5">
            {[
              { name: 'Vels University', canteens: '12 Cafeterias', status: 'Active' },
              { name: 'SRM University', canteens: '8 Cafeterias', status: 'Active' },
              { name: 'Anna University', canteens: '6 Cafeterias', status: 'Active' },
              { name: 'PSG College', canteens: '4 Cafeterias', status: 'Active' }
            ].map((t, idx) => (
              <div key={idx} className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-[#1d68f2]/10 text-[#1d68f2] flex items-center justify-center font-bold text-xs shrink-0">
                    <Building size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{t.name}</div>
                    <div className="text-[10px] text-slate-400">{t.canteens}</div>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isCreating ? (
        <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6">Create New Tenant Organization</h2>
          
          <form onSubmit={handleCreateTenant} className="space-y-6 max-w-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Organization Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Corp"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Subdomain Slug</label>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    required
                    pattern="^[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]$"
                    title="Lowercase letters, numbers, and hyphens only (3-40 chars)"
                    placeholder="acme"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
                    className="w-full pl-4 pr-[120px] py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  <span className="absolute right-4 text-slate-400 text-sm pointer-events-none">
                    .skiptray.com
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-800 mb-4">Initial Admin Account</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Admin Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Admin Email</label>
                  <input
                    type="email"
                    required
                    placeholder="admin@acmecorp.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Admin Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Min. 6 characters"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={creating}
                className="px-6 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {creating ? 'Provisioning...' : 'Provision Tenant'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tenant</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Slug</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500">Loading tenants...</td>
                  </tr>
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500">No tenants found.</td>
                  </tr>
                ) : (
                  tenants.map(tenant => (
                    <tr key={tenant.id} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4">
                        {editingTenantId === tenant.id ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        ) : (
                          <>
                            <div className="font-semibold text-slate-800">
                              {tenant.tenant_settings?.display_name || tenant.name}
                            </div>
                            <div className="text-xs text-slate-500">ID: {tenant.id.slice(0,8)}...</div>
                          </>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {editingTenantId === tenant.id ? (
                          <input
                            type="text"
                            value={editSlug}
                            onChange={(e) => setEditSlug(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-200 rounded font-mono text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        ) : (
                          <span className="font-mono text-sm bg-slate-100 text-slate-600 px-2 py-1 rounded">
                            {tenant.slug}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">
                        {new Date(tenant.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          tenant.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {tenant.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right flex gap-3 justify-end items-center">
                        {editingTenantId === tenant.id ? (
                          <>
                            <button
                              onClick={() => handleSaveEdit(tenant.id)}
                              disabled={savingEdit}
                              className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEditing}
                              disabled={savingEdit}
                              className="text-sm font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEditing(tenant)}
                              className="text-sm font-semibold text-slate-600 hover:text-slate-800"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleActive(tenant.id, tenant.is_active)}
                              className={`text-sm font-semibold ${
                                tenant.is_active ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'
                              }`}
                            >
                              {tenant.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              onClick={() => handleDeleteTenant(tenant.id, tenant.name)}
                              className="text-sm font-semibold text-red-600 hover:text-red-800 ml-2"
                              title="Delete permanently"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
