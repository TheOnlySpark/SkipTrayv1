import React from "react";
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type FoodType = Database['public']['Enums']['food_type'];

export default function AdminDashboard() {
  const { profile, signOut } = useAuth();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ placed: 0, collected: 0, rejected: 0 });
  
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<FoodType>('VEG');

  useEffect(() => {
    fetchMenu();
    fetchStats();
  }, []);

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
    const { data, error } = await supabase.from('menu_items').select('*').order('created_at', { ascending: false });
    if (data) setMenuItems(data);
    setLoading(false);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    
    const { data, error } = await supabase.from('menu_items').insert({
      name: newItemName,
      veg_non_veg: newItemType
    }).select().single();
    
    if (data) {
      setMenuItems([data, ...menuItems]);
      setNewItemName('');
    }
  };

  const handleDeleteItem = async (id: string) => {
    const { error } = await supabase.from('menu_items').delete().eq('id', id);
    if (!error) {
      setMenuItems(menuItems.filter(item => item.id !== id));
    }
  };

  const handleToggleSoldOut = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.rpc('toggle_sold_out', {
      item_id: id,
      new_status: !currentStatus
    });
    
    if (!error) {
      setMenuItems(menuItems.map(item => item.id === id ? { ...item, is_sold_out: !currentStatus } : item));
    }
  };

  return (
    <div className="w-full max-w-4xl grid grid-cols-12 gap-4">
      {/* Header */}
      <div className="col-span-12 bg-indigo-600 border border-indigo-500 rounded-[2rem] p-8 flex flex-col justify-between shadow-sm relative overflow-hidden text-white mb-4">
        <div className="z-10 flex justify-between items-start">
          <div>
            <span className="px-3 py-1 bg-indigo-500 text-indigo-100 text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-400">Admin Console</span>
            <h1 className="text-3xl font-extrabold text-white mt-4 leading-tight">Welcome, {profile?.name || 'Admin'}</h1>
            <p className="text-indigo-200 mt-2 max-w-md">Phase 8: Polish & Admin Reporting</p>
          </div>
          <button onClick={signOut} className="text-sm font-semibold text-indigo-100 hover:text-white bg-indigo-700 px-4 py-2 rounded-xl border border-indigo-500 transition-colors">
            Sign Out
          </button>
        </div>
      </div>

      {/* Daily Summary */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Today's Summary</h2>
        <div className="grid grid-cols-3 gap-4">
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

      {/* Menu Management */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Manage Menu</h2>
        
        {/* Add Item Form */}
        <form onSubmit={handleAddItem} className="flex gap-4 mb-8 bg-slate-50 p-4 rounded-xl border border-slate-100">
          <input 
            type="text" 
            placeholder="Item Name" 
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
          />
          <select 
            value={newItemType} 
            onChange={(e) => setNewItemType(e.target.value as FoodType)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
          >
            <option value="VEG">Veg</option>
            <option value="NON_VEG">Non-Veg</option>
          </select>
          <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
            Add Item
          </button>
        </form>

        {/* Menu List */}
        {loading ? (
          <div className="text-slate-500 text-sm">Loading menu...</div>
        ) : (
          <div className="space-y-3">
            {menuItems.map(item => (
              <div key={item.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${item.veg_non_veg === 'VEG' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className={`font-semibold ${item.is_sold_out ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.name}</span>
                  {item.is_sold_out && <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Sold Out</span>}
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
                    className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {item.is_sold_out ? 'Mark Available' : 'Mark Sold Out'}
                  </button>
                  <button 
                    onClick={() => handleDeleteItem(item.id)}
                    className="text-xs font-semibold text-red-500 bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {menuItems.length === 0 && (
              <div className="text-slate-500 text-sm text-center py-4">No menu items yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
