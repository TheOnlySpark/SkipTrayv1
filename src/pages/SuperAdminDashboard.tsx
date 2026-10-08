import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Building, Plus, Users, Search, AlertCircle, CheckCircle, Store, ShoppingBag } from 'lucide-react';
import { CancellationManagement } from '../components/CancellationManagement';

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
          slug: newSlug,
          name: newName,
          admin_name: adminName,
          admin_email: adminEmail,
          admin_password: adminPassword
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create tenant');
      }

      setSuccess(`Tenant created successfully! Admin invite sent to ${adminEmail}`);
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
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTenant = async (tenantId: string, tenantName: string) => {
    if (!window.confirm(`Are you sure you want to PERMANENTLY delete "${tenantName}" and ALL of its associated users, orders, and menu items? This action cannot be undone.`)) {
      return;
    }

    try {
      setError('');
      const { data, error } = await supabase.rpc('admin_delete_tenant_cascade', {
        p_tenant_id: tenantId
      });

      if (error) throw error;
      
      setSuccess(`Tenant "${tenantName}" deleted successfully`);
      fetchTenants();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      console.error('Delete tenant error:', err);
      setError(err.message);
      setTimeout(() => setError(''), 5000);
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
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
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

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
            <Store size={24} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">Total Tenants</p>
            <p className="text-2xl font-bold text-slate-800">{totalTenants}</p>
          </div>
        </div>
        {/* Placeholder for future cross-tenant analytics */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 opacity-75">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
            <ShoppingBag size={24} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">Global Orders (Today)</p>
            <p className="text-2xl font-bold text-slate-800">--</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 opacity-75">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">Global Active Users</p>
            <p className="text-2xl font-bold text-slate-800">--</p>
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

      <div className="pt-8">
        <CancellationManagement isSuperAdmin={true} />
      </div>
    </div>
  );
}
