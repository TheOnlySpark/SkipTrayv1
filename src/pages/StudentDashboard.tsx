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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {menuItems.map(item => (
                <div key={item.id} className={`flex flex-col justify-between p-5 rounded-2xl border transition-all ${item.is_sold_out ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'}`}>
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${item.veg_non_veg === 'VEG' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      {item.is_sold_out && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Sold Out</span>}
                    </div>
                    <h3 className="font-bold text-slate-800 leading-tight">{item.name}</h3>
                  </div>
                  
                  <div className="mt-6 flex justify-end">
                    {!item.is_sold_out ? (
                      <button 
                        onClick={() => addToCart(item)}
                        disabled={cartTotalItems >= 5}
                        className="w-10 h-10 flex items-center justify-center bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-600 hover:text-white transition-colors disabled:opacity-50 disabled:hover:bg-indigo-50 disabled:hover:text-indigo-600 shadow-sm"
                      >
                        +
                      </button>
                    ) : (
                      <div className="h-10"></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cart */}
          <div className="col-span-4 bg-slate-900 rounded-[2rem] p-8 text-white flex flex-col shadow-sm">
            <h3 className="font-bold text-lg mb-6 text-slate-100">Your Order</h3>
            
            <div className="space-y-4 mb-8">
              {cart.map(c => {
                const liveItem = menuItems.find(m => m.id === c.item.id);
                const isSoldOut = liveItem?.is_sold_out ?? false;
                return (
                  <div key={c.item.id} className={`flex justify-between items-center border-b pb-3 ${isSoldOut ? 'border-red-500/30' : 'border-slate-800'}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isSoldOut ? 'text-red-400 line-through' : 'text-slate-200'}`}>{c.item.name}</span>
                        {isSoldOut && (
                          <span className="text-[10px] font-bold text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Sold Out</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">Qty: {c.quantity}</div>
                    </div>
                    <button 
                      onClick={() => removeFromCart(c.item.id)}
                      className={`text-xs px-2 py-1 rounded ${isSoldOut ? 'text-red-400 hover:text-red-300 bg-red-500/10' : 'text-slate-400 hover:text-white bg-slate-800'}`}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {cart.length === 0 && (
                <div className="text-slate-500 text-sm text-center mt-10">Select items from the menu. (Max 5)</div>
              )}
            </div>

            {/* Sold out summary warning */}
            {cart.some(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out) && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-400 text-xs font-semibold mb-1">⚠ Sold out items in your order:</p>
                <ul className="text-red-300 text-xs space-y-0.5">
                  {cart
                    .filter(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out)
                    .map(c => (
                      <li key={c.item.id}>• {c.item.name}</li>
                    ))
                  }
                </ul>
                <p className="text-red-400/70 text-[10px] mt-2">Remove sold out items to place your order.</p>
              </div>
            )}

            <form onSubmit={handlePlaceOrder} className="pt-4 border-t border-slate-800">
              {error && <div className="text-red-400 text-xs mb-3 font-semibold">{error}</div>}
              <div className="mb-4">
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-2">Pickup Time (9 AM – 6 PM)</label>
                <div className="flex gap-2">
                  <select
                    value={pickupTime.split(':')[0] || ''}
                    onChange={e => {
                      const hour = e.target.value;
                      const minute = pickupTime.split(':')[1] || '00';
                      setPickupTime(hour ? `${hour}:${minute}` : '');
                    }}
                    className="flex-1 bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm appearance-none cursor-pointer"
                  >
                    <option value="">Hour</option>
                    {Array.from({ length: 10 }, (_, i) => i + 9).map(h => (
                      <option key={h} value={String(h).padStart(2, '0')}>
                        {h > 12 ? `${h - 12} PM` : h === 12 ? '12 PM' : `${h} AM`}
                      </option>
                    ))}
                  </select>
                  <select
                    value={pickupTime.split(':')[1] || ''}
                    onChange={e => {
                      const hour = pickupTime.split(':')[0] || '09';
                      setPickupTime(`${hour}:${e.target.value}`);
                    }}
                    disabled={!pickupTime.split(':')[0]}
                    className="flex-1 bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm appearance-none cursor-pointer disabled:opacity-50"
                  >
                    <option value="">Min</option>
                    {['00', '10', '20', '30', '40', '50'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button 
                type="submit"
                disabled={cart.length === 0 || !pickupTime || submitting || cart.some(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out)}
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
