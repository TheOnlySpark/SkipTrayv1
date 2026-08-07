import React from "react";
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type FoodType = Database['public']['Enums']['food_type'];
type Review = Database['public']['Tables']['item_reviews']['Row'] & {
  menu_items: { name: string } | null;
  profiles: { name: string | null; id_number: string | null } | null;
  orders: { order_number: number } | null;
};

export default function AdminDashboard() {
  const { profile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ placed: 0, collected: 0, rejected: 0 });
  
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['adminReviews'],
    queryFn: async () => {
      const { data } = await supabase
        .from('item_reviews')
        .select(`
          *,
          menu_items (name),
          profiles (name, id_number),
          orders (order_number)
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
      alert('Failed to submit reply. Please try again.');
    } else {
      setReplyingTo(null);
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['adminReviews'] });
    }
    setSubmittingReply(false);
  };
  
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<FoodType>('VEG');

  useEffect(() => {
    fetchMenu();
    fetchStats();

    const orderSub = supabase
      .channel('admin:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchStats();
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
      <div className="col-span-12 md:col-span-6 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm flex flex-col">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Manage Menu</h2>
        
        {/* Add Item Form */}
        <form onSubmit={handleAddItem} className="flex gap-4 mb-8 bg-slate-50 p-4 rounded-xl border border-slate-100 flex-wrap">
          <input 
            type="text" 
            placeholder="Item Name" 
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            maxLength={100}
            className="flex-1 min-w-[120px] px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
          />
          <select 
            value={newItemType} 
            onChange={(e) => setNewItemType(e.target.value as FoodType)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-800"
          >
            <option value="VEG">Veg</option>
            <option value="NON_VEG">Non-Veg</option>
          </select>
          <button type="submit" className="w-full sm:w-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
            Add
          </button>
        </form>

        {/* Menu List */}
        {loading ? (
          <div className="text-slate-500 text-sm">Loading menu...</div>
        ) : (
          <div className="space-y-3 flex-1 overflow-y-auto min-h-[300px]">
            {menuItems.map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors shadow-sm gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${item.veg_non_veg === 'VEG' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className={`font-semibold ${item.is_sold_out ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.name}</span>
                  {item.is_sold_out && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full shrink-0">Sold Out</span>}
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button 
                    onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
                    className="text-[10px] sm:text-xs font-semibold text-slate-500 bg-slate-100 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {item.is_sold_out ? 'Mark Available' : 'Mark Sold Out'}
                  </button>
                  <button 
                    onClick={() => handleDeleteItem(item.id)}
                    className="text-[10px] sm:text-xs font-semibold text-red-500 bg-red-50 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
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

      {/* Feedback & Reviews */}
      <div className="col-span-12 md:col-span-6 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm flex flex-col">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Student Feedback & Reviews</h2>
        
        {reviewsLoading ? (
          <div className="text-slate-500 text-sm">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="text-slate-500 text-sm py-4">No reviews yet.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 flex-1 overflow-y-auto min-h-[300px]">
            {reviews.map(review => (
              <div key={review.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col gap-3 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-800">
                      {review.orders?.order_number ? `Order #${review.orders.order_number} - ` : ''}
                      {review.menu_items?.name || 'Unknown Item'}
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      By {review.profiles?.name || 'Unknown'} ({review.profiles?.id_number || 'No ID'})
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} className={`text-lg ${i < review.rating ? 'text-yellow-400' : 'text-slate-200'}`}>★</span>
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

    </div>
  );
}
