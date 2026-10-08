import React, { useState, useEffect } from "react";
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type Canteen = Database['public']['Tables']['canteens']['Row'];

export default function UniAdminDashboard() {
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

  const { data: canteenAdmins = [], isLoading: adminsLoading } = useQuery({
    queryKey: ['canteenAdmins', currentTenantId],
    enabled: !!currentTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, canteens(name)')
        .eq('tenant_id', currentTenantId!)
        // @ts-ignore
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
    if (!name || !currentTenantId) return;

    setCreatingCanteen(true);
    const { error } = await supabase.from('canteens').insert({
      name,
      code: newCanteenCode.trim().toUpperCase() || null,
      tenant_id: currentTenantId
    });
    setCreatingCanteen(false);

    if (error) {
      showAlert({ title: 'Error', message: error.message, type: 'error' });
      return;
    }

    setNewCanteenName('');
    setNewCanteenCode('');
    await queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
    showAlert({ title: 'Location added', message: `${name} has been added.`, type: 'success' });
  };

  const handleToggleCanteen = async (canteen: Canteen) => {
    const { data, error } = await supabase
      .from('canteens')
      .update({ is_active: !canteen.is_active })
      .eq('id', canteen.id)
      .select('id, is_active')
      .maybeSingle();

    if (error) {
      showAlert({ title: 'Error', message: error.message, type: 'error' });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['adminCanteens', currentTenantId] });
  };

  const handleCreateCanteenAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCanteenId) {
      showAlert({ title: 'Error', message: 'Please select a canteen first', type: 'error' });
      return;
    }
    setCreatingAdmin(true);
    try {
      // @ts-ignore
      const functionsUrl = import.meta.env.VITE_SUPABASE_URL
        // @ts-ignore
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
          name: newAdminName,
          email: newAdminEmail,
          password: newAdminPassword,
          role: 'CANTEEN_ADMIN',
          canteen_id: selectedCanteenId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create admin');
      }

      showAlert({ title: 'Success', message: `Created canteen admin for ${newAdminEmail}`, type: 'success' });

      setNewAdminName('');
      setNewAdminEmail('');
      setNewAdminPassword('');
      queryClient.invalidateQueries({ queryKey: ['canteenAdmins', currentTenantId] });
    } catch (err: any) {
      showAlert({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setCreatingAdmin(false);
    }
  };

  return (
    <div className="w-full max-w-4xl grid grid-cols-1 gap-6">
      <div className="bg-indigo-600 rounded-[2rem] p-8 text-white shadow-sm">
        <span className="px-3 py-1 bg-indigo-500 text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-400">University Admin</span>
        <h1 className="text-3xl font-extrabold mt-4 leading-tight">Welcome, {profile?.name || 'Admin'}</h1>
        <p className="mt-2 text-indigo-100">Manage all canteens and their administrators for your university.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Manage Canteens</h2>
        <form onSubmit={handleAddCanteen} className="grid grid-cols-1 sm:grid-cols-[1fr_12rem_auto] gap-3 mb-6">
          <input type="text" required placeholder="Canteen Name (e.g. Engineering Block)" value={newCanteenName} onChange={e => setNewCanteenName(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
          <input type="text" placeholder="Short Code (e.g. ENG)" value={newCanteenCode} onChange={e => setNewCanteenCode(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
          <button type="submit" disabled={creatingCanteen || !currentTenantId} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
            {creatingCanteen ? 'Adding...' : 'Add Canteen'}
          </button>
        </form>

        {canteensLoading ? (
          <div className="text-slate-500 text-sm">Loading canteens...</div>
        ) : canteens.length === 0 ? (
          <div className="text-sm text-slate-500 bg-slate-50 p-4 rounded-xl">No canteens found. Create one above.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {canteens.map(canteen => (
              <div key={canteen.id} className="flex justify-between items-center p-4 border border-slate-200 rounded-xl">
                <div>
                  <div className="font-semibold text-slate-800">{canteen.name}</div>
                  <div className="text-xs text-slate-500">{canteen.code || 'No code'} • {canteen.is_active ? 'Active' : 'Inactive'}</div>
                </div>
                <button onClick={() => handleToggleCanteen(canteen)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${canteen.is_active ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {canteen.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Create Canteen Admin</h2>
        <form onSubmit={handleCreateCanteenAdmin} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <select required value={selectedCanteenId} onChange={e => setSelectedCanteenId(e.target.value)} className="sm:col-span-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm">
            {canteens.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="text" required placeholder="Admin Name" value={newAdminName} onChange={e => setNewAdminName(e.target.value)} className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <input type="email" required placeholder="Admin Email" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <input type="password" required placeholder="Password" value={newAdminPassword} onChange={e => setNewAdminPassword(e.target.value)} className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <button type="submit" disabled={creatingAdmin || !selectedCanteenId} className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-semibold hover:bg-slate-900 transition">
            {creatingAdmin ? 'Creating...' : 'Create Admin'}
          </button>
        </form>

        <h3 className="font-bold text-slate-700 mb-4 mt-8">Existing Canteen Admins</h3>
        {adminsLoading ? (
          <div className="text-sm text-slate-500">Loading...</div>
        ) : canteenAdmins.length === 0 ? (
          <div className="text-sm text-slate-500">No canteen admins found.</div>
        ) : (
          <div className="space-y-3">
            {canteenAdmins.map((admin: any) => (
              <div key={admin.id} className="p-4 border border-slate-200 rounded-xl flex justify-between items-center">
                <div>
                  <div className="font-semibold text-slate-800">{admin.name}</div>
                  <div className="text-xs text-slate-500">Assigned to: {admin.canteens?.name || 'Unknown'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
