import React from "react";
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type Order = Database['public']['Tables']['orders']['Row'];

export default function StudentDashboard() {
  const { profile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [pastOrders, setPastOrders] = useState<Order[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  const [cart, setCart] = useState<{item: MenuItem, quantity: number}[]>([]);
  const [pickupTime, setPickupTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Listen to changes on our active order
    const subscription = supabase
      .channel('public:orders')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `user_id=eq.${profile?.id}`
      }, (payload) => {
        const updatedOrder = payload.new as Order;
        if (['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(updatedOrder.status)) {
          setActiveOrder(updatedOrder);
        } else {
          // If collected or rejected, clear active order
          setActiveOrder(null);
        }
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [profile?.id]);

  const { data: menuItems = [], isLoading: menuLoading } = useQuery({
    queryKey: ['menuItems'],
    queryFn: async () => {
      const { data } = await supabase.from('menu_items').select('*').order('name');
      return data || [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { data: pastOrdersData = [], isLoading: pastOrdersLoading } = useQuery({
    queryKey: ['pastOrders', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', profile.id)
        .in('status', ['COLLECTED', 'REJECTED'])
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!profile?.id,
  });

  useEffect(() => {
    if (pastOrdersData) setPastOrders(pastOrdersData);
  }, [pastOrdersData]);

  useEffect(() => {
    const fetchActive = async () => {
      if (!profile?.id) return;
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', profile.id)
        .in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])
        .maybeSingle();
      if (data) setActiveOrder(data);
    };
    fetchActive();
  }, [profile?.id]);

  const cartTotalItems = cart.reduce((acc, c) => acc + c.quantity, 0);

  const addToCart = (item: MenuItem) => {
    if (item.is_sold_out) return;
    if (cartTotalItems >= 5) return;
    
    const existing = cart.find(c => c.item.id === item.id);
    if (existing) {
      setCart(cart.map(c => c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { item, quantity: 1 }]);
    }
  };

  const removeFromCart = (itemId: string) => {
    const existing = cart.find(c => c.item.id === itemId);
    if (existing && existing.quantity > 1) {
      setCart(cart.map(c => c.item.id === itemId ? { ...c, quantity: c.quantity - 1 } : c));
    } else {
      setCart(cart.filter(c => c.item.id !== itemId));
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0 || !pickupTime) return;
    setSubmitting(true);
    setError('');

    const itemsJson = cart.map(c => ({
      menu_item_id: c.item.id,
      quantity: c.quantity
    }));

    const { data, error } = await supabase.rpc('place_order_with_otp', {
      p_pickup_time: pickupTime,
      p_items: itemsJson
    });

    if (error) {
      setError(error.message);
    } else {
      // Fetch the newly created order
      const { data: newOrder } = await supabase.from('orders').select('*').eq('id', data).single();
      if (newOrder) {
        setActiveOrder(newOrder);
      }
      setCart([]);
      setPickupTime('');
    }
    setSubmitting(false);
  };

  const handleCancelOrder = async () => {
    if (!activeOrder) return;
    if (!window.confirm("Are you sure you want to cancel this order?")) return;
    
    // In Phase 7, we use an RPC to enforce the 5 min rule securely
    const { error } = await supabase.rpc('cancel_order', {
      p_order_id: activeOrder.id
    });
    
    if (error) {
      alert(error.message);
    } else {
      setActiveOrder(null);
      queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PLACED': return 'bg-slate-100 text-slate-600';
      case 'ACCEPTED': return 'bg-blue-100 text-blue-600';
      case 'PREPARING': return 'bg-orange-100 text-orange-600';
      case 'READY': return 'bg-green-100 text-green-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <div className="w-full max-w-4xl grid grid-cols-12 gap-4">
      {/* Header */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-8 flex flex-col justify-between shadow-sm relative overflow-hidden mb-4">
        <div className="z-10 flex justify-between items-start">
          <div>
            <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-bold uppercase tracking-wider rounded-full">{profile?.role || 'Student'}</span>
            <h1 className="text-3xl font-extrabold text-slate-900 mt-4 leading-tight">Welcome, {profile?.name || 'User'}</h1>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => setShowHistory(!showHistory)} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100 transition-colors">
              {showHistory ? 'Back to Order' : 'Order History'}
            </button>
            <button onClick={signOut} className="text-sm font-semibold text-slate-500 hover:text-slate-800 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 transition-colors">
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {menuLoading ? (
        <div className="col-span-12 text-center text-slate-500">Loading...</div>
      ) : showHistory ? (
        <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-800 mb-6">Past Orders</h2>
          {pastOrders.length === 0 ? (
            <div className="text-slate-500">No past orders found.</div>
          ) : (
            <div className="space-y-4">
              {pastOrders.map(o => (
                <div key={o.id} className="p-4 rounded-xl border border-slate-200 flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-slate-800">Placed on: {new Date(o.created_at).toLocaleDateString()}</div>
                    <div className="text-sm text-slate-500">Pickup: {o.pickup_time}</div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border ${o.status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                    {o.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeOrder ? (
        // Active Order View
        <div className="col-span-12 bg-indigo-600 rounded-[2rem] p-8 text-white flex flex-col items-center justify-center min-h-[300px] shadow-sm relative overflow-hidden">
          {/* Cancel button if within 5 mins and not preparing */}
          {['PLACED', 'ACCEPTED'].includes(activeOrder.status) && (new Date().getTime() - new Date(activeOrder.created_at).getTime()) < 5 * 60 * 1000 && (
            <button 
              onClick={handleCancelOrder}
              className="absolute top-6 right-6 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              Cancel Order
            </button>
          )}

          <h2 className="text-2xl font-bold mb-2">Your Order Status</h2>
          <div className={`mt-4 px-6 py-2 rounded-full font-bold text-sm tracking-wider uppercase ${getStatusColor(activeOrder.status).replace('100', '900').replace('600', '100')}`}>
            {activeOrder.status}
          </div>
          
          <div className="mt-8 bg-white/10 p-6 rounded-2xl border border-white/20 text-center w-full max-w-xs">
            <p className="text-indigo-200 text-sm font-semibold uppercase tracking-widest mb-2">Pickup OTP</p>
            <p className="text-5xl font-mono font-bold tracking-[0.2em]">{activeOrder.otp_code}</p>
          </div>
          
          <p className="mt-6 text-indigo-200">Requested Pickup Time: <span className="font-semibold text-white">{activeOrder.pickup_time}</span></p>
        </div>
      ) : (
        <>
          {/* Menu */}
          <div className="col-span-8 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800 mb-6">Menu</h2>
            <div className="grid grid-cols-1 gap-3">
              {menuItems.map(item => (
                <div key={item.id} className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${item.is_sold_out ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${item.veg_non_veg === 'VEG' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="font-semibold text-slate-800">{item.name}</span>
                    {item.is_sold_out && <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Sold Out</span>}
                  </div>
                  {!item.is_sold_out && (
                    <button 
                      onClick={() => addToCart(item)}
                      disabled={cartTotalItems >= 5}
                      className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-50"
                    >
                      +
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Cart */}
          <div className="col-span-4 bg-slate-900 rounded-[2rem] p-8 text-white flex flex-col shadow-sm">
            <h3 className="font-bold text-lg mb-6 text-slate-100">Your Order</h3>
            
            <div className="flex-grow space-y-4 mb-8">
              {cart.map(c => (
                <div key={c.item.id} className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">{c.item.name}</div>
                    <div className="text-xs text-slate-500 mt-1">Qty: {c.quantity}</div>
                  </div>
                  <button 
                    onClick={() => removeFromCart(c.item.id)}
                    className="text-xs text-slate-400 hover:text-white bg-slate-800 px-2 py-1 rounded"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="text-slate-500 text-sm text-center mt-10">Select items from the menu. (Max 5)</div>
              )}
            </div>

            <form onSubmit={handlePlaceOrder} className="mt-auto pt-4 border-t border-slate-800">
              {error && <div className="text-red-400 text-xs mb-3 font-semibold">{error}</div>}
              <div className="mb-4">
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-2">Pickup Time</label>
                <input 
                  type="time"
                  required
                  value={pickupTime}
                  onChange={e => setPickupTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              <button 
                type="submit"
                disabled={cart.length === 0 || !pickupTime || submitting}
                className="w-full py-3 bg-indigo-500 text-white rounded-xl font-bold text-sm shadow-sm hover:bg-indigo-400 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Placing...' : `Place Order (${cartTotalItems} items)`}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
