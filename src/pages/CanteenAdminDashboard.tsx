import React, { useState, useEffect } from "react";
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from '../lib/edgeFunction';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type FoodType = Database['public']['Enums']['food_type'];

export default function CanteenAdminDashboard() {
  const { profile } = useAuth();
  const { showAlert } = useDialog();
  const queryClient = useQueryClient();

  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemType, setNewItemType] = useState<FoodType>('VEG');
  
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);

  const currentCanteenId = profile?.canteen_id;
  const currentTenantId = profile?.tenant_id;

  const { data: menuItems = [], isLoading: menuLoading } = useQuery({
    queryKey: ['canteenMenu', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('canteen_id', currentCanteenId)
        .order('name');
      if (error) throw error;
      return data as MenuItem[];
    }
  });

  const { data: staffList = [], isLoading: staffLoading } = useQuery({
    queryKey: ['canteenStaff', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('canteen_id', currentCanteenId)
        .eq('role', 'STAFF')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  const { data: canteenDetails } = useQuery({
    queryKey: ['canteenDetails', currentCanteenId],
    enabled: !!currentCanteenId,
    queryFn: async () => {
      const { data, error } = await supabase.from('canteens').select('*').eq('id', currentCanteenId).single();
      if (error) throw error;
      return data;
    }
  });

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !currentCanteenId || !currentTenantId) return;

    const { error } = await supabase.from('menu_items').insert({
      name: newItemName.trim(),
      veg_non_veg: newItemType,
      price: parseFloat(newItemPrice) || 0,
      tenant_id: currentTenantId,
      canteen_id: currentCanteenId
    });

    if (error) {
      showAlert({ title: 'Error', message: error.message, type: 'error' });
      return;
    }

    setNewItemName('');
    setNewItemPrice('');
    queryClient.invalidateQueries({ queryKey: ['canteenMenu', currentCanteenId] });
    showAlert({ title: 'Success', message: 'Menu item added', type: 'success' });
  };

  const handleToggleSoldOut = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.rpc('toggle_sold_out', {
      item_id: id,
      new_status: !currentStatus
    });

    if (error) {
      showAlert({ title: 'Error', message: error.message, type: 'error' });
    } else {
      queryClient.invalidateQueries({ queryKey: ['canteenMenu', currentCanteenId] });
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCanteenId) return;
    setCreatingStaff(true);
    try {
      await invokeEdgeFunction('create-tenant-user', {
        method: 'POST',
        body: {
          name: newStaffName,
          email: newStaffEmail,
          password: newStaffPassword,
          role: 'STAFF',
          canteen_id: currentCanteenId
        }
      });

      showAlert({ title: 'Success', message: `Staff member created successfully`, type: 'success' });
      
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      queryClient.invalidateQueries({ queryKey: ['canteenStaff', currentCanteenId] });
    } catch (err: any) {
      showAlert({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setCreatingStaff(false);
    }
  };

  if (!currentCanteenId) {
    return <div className="text-center p-8">You are not assigned to any canteen. Please contact your University Admin.</div>;
  }

  return (
    <div className="w-full max-w-4xl grid grid-cols-1 gap-6">
      <div className="bg-emerald-600 rounded-[2rem] p-8 text-white shadow-sm">
        <span className="px-3 py-1 bg-emerald-500 text-xs font-bold uppercase tracking-wider rounded-full border border-emerald-400">Canteen Admin</span>
        <h1 className="text-3xl font-extrabold mt-4 leading-tight">Welcome, {profile?.name || 'Admin'}</h1>
        <p className="mt-2 text-emerald-100">Managing {canteenDetails?.name || 'your assigned canteen'}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Menu Items</h2>
        <form onSubmit={handleAddItem} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-3 mb-6">
          <input type="text" required placeholder="Item Name" value={newItemName} onChange={e => setNewItemName(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <input type="number" required placeholder="Price" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} min="0" step="any" className="w-24 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <select value={newItemType} onChange={e => setNewItemType(e.target.value as FoodType)} className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm">
            <option value="VEG">VEG</option>
            <option value="NON_VEG">NON-VEG</option>
          </select>
          <button type="submit" className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition">Add Item</button>
        </form>

        {menuLoading ? <div className="text-sm text-slate-500">Loading...</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {menuItems.map(item => (
              <div key={item.id} className="flex justify-between items-center p-4 border border-slate-200 rounded-xl">
                <div>
                  <div className="font-semibold text-slate-800">{item.name} <span className="text-xs font-bold text-emerald-600">₹{item.price}</span></div>
                  <div className="text-xs text-slate-500">{item.veg_non_veg}</div>
                </div>
                <button onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${item.is_sold_out ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                  {item.is_sold_out ? 'Mark Available' : 'Mark Sold Out'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Manage Staff</h2>
        <form onSubmit={handleCreateStaff} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 mb-6">
          <input type="text" required placeholder="Staff Name" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <input type="email" required placeholder="Staff Email" value={newStaffEmail} onChange={e => setNewStaffEmail(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <input type="password" required placeholder="Password" value={newStaffPassword} onChange={e => setNewStaffPassword(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          <button type="submit" disabled={creatingStaff} className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-semibold hover:bg-slate-900 transition">
            {creatingStaff ? 'Creating...' : 'Add Staff'}
          </button>
        </form>

        {staffLoading ? <div className="text-sm text-slate-500">Loading...</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {staffList.map((staff: any) => (
              <div key={staff.id} className="p-4 border border-slate-200 rounded-xl">
                <div className="font-semibold text-slate-800">{staff.name}</div>
                <div className="text-xs text-slate-500">Role: {staff.role}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
