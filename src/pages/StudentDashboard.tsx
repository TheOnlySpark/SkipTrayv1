import React from "react";
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type MenuItem = Database['public']['Tables']['menu_items']['Row'];
type Order = Database['public']['Tables']['orders']['Row'];
type ItemReview = Database['public']['Tables']['item_reviews']['Row'];
type PastOrder = Order & {
  order_items: { menu_items: MenuItem | null }[];
  item_reviews: ItemReview[];
};

export default function StudentDashboard() {
  const { profile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [pastOrders, setPastOrders] = useState<PastOrder[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  const [cart, setCart] = useState<{item: MenuItem, quantity: number}[]>([]);
  const [pickupTime, setPickupTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cartOpen, setCartOpen] = useState(false);

  const [reviewingItem, setReviewingItem] = useState<{ orderId: string, menuItemId: string, itemName: string } | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;

    // Listen to changes on our active order and past orders
    const orderSub = supabase
      .channel('public:orders')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `user_id=eq.${profile.id}`
      }, (payload) => {
        const updatedOrder = payload.new as Order;
        if (['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(updatedOrder.status)) {
          setActiveOrder(updatedOrder);
        } else {
          // If collected or rejected, clear active order and refresh history
          setActiveOrder(null);
          queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
        }
      })
      .subscribe();

    // Listen to changes on menu items (e.g. sold out status)
    const menuSub = supabase
      .channel('public:menu_items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      })
      .subscribe();

    // Listen to changes on item reviews (e.g. admin reply)
    const reviewSub = supabase
      .channel('public:item_reviews')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'item_reviews',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
      })
      .subscribe();

    return () => {
      orderSub.unsubscribe();
      menuSub.unsubscribe();
      reviewSub.unsubscribe();
    };
  }, [profile?.id, queryClient]);

  const { data: menuItems = [], isLoading: menuLoading } = useQuery({
    queryKey: ['menuItems'],
    queryFn: async () => {
      const { data } = await supabase
        .from('menu_items')
        .select('*')
        .order('veg_non_veg', { ascending: false })
        .order('name');
      return (data || []).sort((a, b) => {
        if (a.veg_non_veg !== b.veg_non_veg) {
          return a.veg_non_veg === 'VEG' ? -1 : 1;
        }
        if (a.name.toLowerCase() === 'veg meals') return -1;
        if (b.name.toLowerCase() === 'veg meals') return 1;
        return a.name.localeCompare(b.name);
      });
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { data: pastOrdersData = [], isLoading: pastOrdersLoading } = useQuery({
    queryKey: ['pastOrders', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            menu_items (*)
          ),
          item_reviews (*)
        `)
        .eq('user_id', profile.id)
        .in('status', ['COLLECTED', 'REJECTED'])
        .order('created_at', { ascending: false });
      return (data as unknown as PastOrder[]) || [];
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
  const cartTotalPrice = cart.reduce((acc, c) => acc + (Number(c.item.price || 0) * c.quantity), 0);

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
      alert('Unable to cancel order. ' + (error.message.includes('5 minutes') ? 'Cancellation window has passed.' : 'Please try again.'));
    } else {
      setActiveOrder(null);
      queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingItem || !profile?.id) return;
    setSubmittingReview(true);
    
    const { error } = await supabase.from('item_reviews').insert({
      order_id: reviewingItem.orderId,
      menu_item_id: reviewingItem.menuItemId,
      user_id: profile.id,
      rating: reviewRating,
      feedback_text: reviewText
    });
    
    if (error) {
      alert('Failed to submit review. Please try again.');
    } else {
      setReviewingItem(null);
      setReviewRating(5);
      setReviewText('');
      queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
    }
    setSubmittingReview(false);
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
    <div className="w-full max-w-4xl grid grid-cols-12 gap-4 pb-24">
      {/* Header */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 flex flex-col justify-between shadow-sm relative overflow-hidden mb-4">
        <div className="z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 sm:gap-4">
          <div>
            <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-bold uppercase tracking-wider rounded-full">{profile?.role || 'Student'}</span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-4 leading-tight">Welcome, {profile?.name || 'User'}</h1>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button onClick={() => setShowHistory(!showHistory)} className="flex-1 text-center text-sm font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-4 py-3 sm:py-2 rounded-xl border border-indigo-100 transition-colors">
              {showHistory ? 'Back to Order' : 'Order History'}
            </button>
            <button onClick={signOut} className="flex-1 text-center text-sm font-semibold text-slate-500 hover:text-slate-800 bg-slate-50 px-4 py-3 sm:py-2 rounded-xl border border-slate-200 transition-colors">
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {menuLoading ? (
        <div className="col-span-12 text-center text-slate-500">Loading...</div>
      ) : showHistory ? (
        <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-800 mb-6">Past Orders</h2>
          {pastOrders.length === 0 ? (
            <div className="text-slate-500">No past orders found.</div>
          ) : (
            <div className="space-y-4">
              {pastOrders.map(o => (
                <div key={o.id} className="p-4 rounded-xl border border-slate-200 flex flex-col gap-4 shadow-sm">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <div>
                      <div className="font-bold text-slate-800 text-lg">Order #{o.order_number}</div>
                      <div className="text-xs text-slate-500 font-mono font-medium mb-1">ID: {o.id.split('-')[0].toUpperCase()}</div>
                      <div className="text-xs text-slate-500 font-medium mb-1">Placed on: {new Date(o.created_at).toLocaleDateString()}</div>
                      <div className="text-sm text-slate-600 mt-1">Pickup: {o.pickup_time}</div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold border ${o.status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                      {o.status}
                    </div>
                  </div>
                  
                  {o.order_items && o.order_items.length > 0 && (
                    <div className="space-y-3">
                      {o.order_items.map((oi, idx) => {
                        const menuItem = oi.menu_items;
                        if (!menuItem) return null;
                        const existingReview = o.item_reviews?.find(r => r.menu_item_id === menuItem.id);
                        
                        return (
                          <div key={idx} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-slate-700">
                                {menuItem.name}
                                {menuItem.price !== undefined && menuItem.price !== null && (
                                  <span className="text-xs text-indigo-600 font-bold ml-2">₹{Number(menuItem.price).toFixed(2)}</span>
                                )}
                              </span>
                              {o.status === 'COLLECTED' && !existingReview && reviewingItem?.menuItemId !== menuItem.id && (
                                <button
                                  onClick={() => setReviewingItem({ orderId: o.id, menuItemId: menuItem.id, itemName: menuItem.name })}
                                  className="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  Leave Review
                                </button>
                              )}
                            </div>
                            
                            {/* Existing Review Display */}
                            {existingReview && (
                              <div className="mt-1 bg-white p-3 rounded-lg border border-indigo-100 shadow-sm">
                                <div className="flex items-center gap-1 mb-1">
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <span key={i} className={`text-sm ${i < existingReview.rating ? 'text-yellow-400' : 'text-slate-200'}`}>★</span>
                                  ))}
                                </div>
                                {existingReview.feedback_text && (
                                  <p className="text-sm text-slate-600 italic">"{existingReview.feedback_text}"</p>
                                )}
                                {existingReview.admin_reply && (
                                  <div className="mt-2 pl-3 border-l-2 border-indigo-300">
                                    <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Admin Reply</span>
                                    <p className="text-sm text-slate-700 mt-0.5">{existingReview.admin_reply}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Review Form */}
                            {reviewingItem?.orderId === o.id && reviewingItem?.menuItemId === menuItem.id && (
                              <form onSubmit={handleSubmitReview} className="mt-2 bg-white p-4 rounded-xl border border-indigo-200 shadow-sm animate-in fade-in slide-in-from-top-2">
                                <div className="flex justify-between items-center mb-3">
                                  <h4 className="font-bold text-slate-800 text-sm">Reviewing {reviewingItem.itemName}</h4>
                                  <button type="button" onClick={() => setReviewingItem(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                                </div>
                                <div className="mb-3">
                                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Rating</label>
                                  <div className="flex gap-2">
                                    {[1, 2, 3, 4, 5].map(star => (
                                      <button
                                        key={star}
                                        type="button"
                                        onClick={() => setReviewRating(star)}
                                        className={`text-2xl hover:scale-110 transition-transform ${star <= reviewRating ? 'text-yellow-400' : 'text-slate-200'}`}
                                      >
                                        ★
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="mb-3">
                                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Feedback (Optional)</label>
                                  <textarea
                                    value={reviewText}
                                    onChange={(e) => setReviewText(e.target.value)}
                                    placeholder="How was the food?"
                                    maxLength={1000}
                                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    rows={2}
                                  />
                                </div>
                                <button
                                  type="submit"
                                  disabled={submittingReview}
                                  className="w-full bg-indigo-600 text-white font-semibold py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                >
                                  {submittingReview ? 'Submitting...' : 'Submit Review'}
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeOrder ? (
        // Active Order View
        <div className="col-span-12 bg-indigo-600 rounded-[2rem] p-5 md:p-8 text-white flex flex-col shadow-sm relative overflow-hidden min-h-[300px]">
          <div className="w-full flex justify-end h-10 mb-2">
            {/* Cancel button if within 5 mins and not preparing */}
            {['PLACED', 'ACCEPTED'].includes(activeOrder.status) && (new Date().getTime() - new Date(activeOrder.created_at).getTime()) < 5 * 60 * 1000 && (
              <button 
                onClick={handleCancelOrder}
                className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel Order
              </button>
            )}
          </div>

          <div className="flex flex-col items-center justify-center flex-1 pb-12">
            <div className="flex items-center justify-center gap-3 mb-1 shadow-sm">
              <h2 className="text-3xl font-extrabold">Order #{activeOrder.order_number}</h2>
              <span className="text-indigo-200 bg-white/10 px-2 py-1 rounded text-xs font-mono tracking-wider border border-white/20">
                ID: {activeOrder.id.split('-')[0].toUpperCase()}
              </span>
            </div>
            <p className="text-indigo-200 font-medium tracking-wide mb-4 text-sm">Your Order Status</p>
          
          <div className={`mt-2 px-6 py-2 rounded-full font-bold text-sm tracking-wider uppercase ${getStatusColor(activeOrder.status).replace('100', '900').replace('600', '100')}`}>
            {activeOrder.status}
          </div>
          
          <div className="mt-8 bg-white/10 p-6 rounded-2xl border border-white/20 text-center w-full max-w-xs">
            <p className="text-indigo-200 text-sm font-semibold uppercase tracking-widest mb-2">Pickup OTP</p>
            <p className="text-5xl font-mono font-bold tracking-[0.2em]">{activeOrder.otp_code}</p>
          </div>
          
          <p className="mt-6 text-indigo-200">Requested Pickup Time: <span className="font-semibold text-white">{activeOrder.pickup_time}</span></p>
          </div>
        </div>
      ) : (
        <>
          {/* Menu — full width now that cart is a floating bar */}
          <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800 mb-6">Menu</h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {menuItems.map(item => (
                <div key={item.id} className={`flex flex-col justify-between p-5 rounded-2xl border transition-all ${item.is_sold_out ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'}`}>
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${item.veg_non_veg === 'VEG' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      {item.is_sold_out && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Sold Out</span>}
                    </div>
                    <h3 className="font-bold text-slate-800 leading-tight">{item.name}</h3>
                    <div className="text-sm font-extrabold text-indigo-600 mt-1.5">₹{Number(item.price || 0).toFixed(2)}</div>
                  </div>
                  
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">{item.veg_non_veg === 'VEG' ? 'Veg' : 'Non-Veg'}</span>
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

          {/* Floating Bottom Cart Bar */}
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 50,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '56rem',
                pointerEvents: 'auto',
                transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              {/* Expanded Panel */}
              <div
                style={{
                  background: '#0f172a',
                  borderRadius: cartOpen ? '1.5rem 1.5rem 0 0' : '1.5rem',
                  overflow: 'hidden',
                  boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
                  margin: cartOpen ? '0' : '0 1rem 1rem',
                  transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                {/* Expanded cart body */}
                {cartOpen && (
                  <div style={{ padding: '1.5rem 1.5rem 0', maxHeight: '60vh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1.1rem' }}>Your Order</h3>
                      <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>Max 5 items</span>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      {cart.length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0' }}>Select items from the menu. (Max 5)</div>
                      ) : (
                        cart.map(c => {
                          const liveItem = menuItems.find(m => m.id === c.item.id);
                          const isSoldOut = liveItem?.is_sold_out ?? false;
                          return (
                            <div key={c.item.id} style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              borderBottom: `1px solid ${isSoldOut ? 'rgba(239,68,68,0.2)' : '#1e293b'}`,
                              borderLeft: `3px solid ${liveItem?.veg_non_veg === 'VEG' ? '#22c55e' : '#ef4444'}`,
                              paddingLeft: '0.75rem',
                              paddingBottom: '0.75rem',
                              marginBottom: '0.75rem',
                            }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <div style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: liveItem?.veg_non_veg === 'VEG' ? '#22c55e' : '#ef4444' }}></div>
                                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: isSoldOut ? '#f87171' : '#e2e8f0', textDecoration: isSoldOut ? 'line-through' : 'none' }}>
                                    {c.item.name}
                                  </span>
                                  {isSoldOut && (
                                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,0.15)', padding: '1px 6px', borderRadius: '9999px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sold Out</span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <span>Qty: {c.quantity}</span>
                                  <span style={{ color: '#94a3b8' }}>• ₹{Number(c.item.price || 0).toFixed(2)}</span>
                                  <span style={{ color: '#818cf8', fontWeight: 600 }}>= ₹{(Number(c.item.price || 0) * c.quantity).toFixed(2)}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => removeFromCart(c.item.id)}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '0.5rem',
                                  background: isSoldOut ? 'rgba(239,68,68,0.1)' : '#1e293b',
                                  color: isSoldOut ? '#f87171' : '#94a3b8',
                                  border: 'none',
                                  cursor: 'pointer',
                                }}
                              >Remove</button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Sold out warning */}
                    {cart.some(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out) && (
                      <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '0.75rem' }}>
                        <p style={{ color: '#f87171', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem' }}>⚠ Sold out items in your order:</p>
                        <ul style={{ color: '#fca5a5', fontSize: '0.75rem' }}>
                          {cart.filter(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out).map(c => (
                            <li key={c.item.id}>• {c.item.name}</li>
                          ))}
                        </ul>
                        <p style={{ color: 'rgba(248,113,113,0.6)', fontSize: '0.625rem', marginTop: '0.5rem' }}>Remove sold out items to place your order.</p>
                      </div>
                    )}

                    {/* Pickup time */}
                    <form onSubmit={handlePlaceOrder} style={{ paddingTop: '1rem', borderTop: '1px solid #1e293b' }}>
                      {error && <div style={{ color: '#f87171', fontSize: '0.75rem', marginBottom: '0.75rem', fontWeight: 600 }}>{error}</div>}
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Pickup Time (9 AM – 6 PM)</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <select
                            value={pickupTime.split(':')[0] || ''}
                            onChange={e => {
                              const hour = e.target.value;
                              const minute = pickupTime.split(':')[1] || '00';
                              setPickupTime(hour ? `${hour}:${minute}` : '');
                            }}
                            style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', color: 'white', padding: '0.5rem 0.75rem', borderRadius: '0.75rem', fontSize: '0.875rem', cursor: 'pointer', appearance: 'none' as const }}
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
                            style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', color: 'white', padding: '0.5rem 0.75rem', borderRadius: '0.75rem', fontSize: '0.875rem', cursor: 'pointer', appearance: 'none' as const, opacity: !pickupTime.split(':')[0] ? 0.5 : 1 }}
                          >
                            <option value="">Min</option>
                            {['00', '10', '20', '30', '40', '50'].map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {/* Total Amount Summary */}
                      {cart.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0.75rem 1rem', background: '#1e293b', borderRadius: '0.75rem' }}>
                          <span style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: 600 }}>Total Amount</span>
                          <span style={{ color: '#38bdf8', fontSize: '1.125rem', fontWeight: 700 }}>₹{cartTotalPrice.toFixed(2)}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={cart.length === 0 || !pickupTime || submitting || cart.some(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out)}
                        style={{
                          width: '100%',
                          padding: '0.875rem',
                          background: cart.length === 0 || !pickupTime || submitting || cart.some(c => menuItems.find(m => m.id === c.item.id)?.is_sold_out)
                            ? 'rgba(99,102,241,0.4)' : '#6366f1',
                          color: 'white',
                          borderRadius: '0.875rem',
                          fontWeight: 700,
                          fontSize: '0.875rem',
                          border: 'none',
                          cursor: cart.length === 0 || !pickupTime || submitting ? 'not-allowed' : 'pointer',
                          transition: 'background 0.2s',
                          marginBottom: '1rem',
                        }}
                      >
                        {submitting ? 'Placing...' : `Place Order (${cartTotalItems} items • ₹${cartTotalPrice.toFixed(2)})`}
                      </button>
                    </form>
                  </div>
                )}

                {/* Always-visible bottom strip / toggle handle */}
                <button
                  onClick={() => setCartOpen(o => !o)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem 1.5rem',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderTop: cartOpen ? '1px solid #1e293b' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '2rem', height: '2rem',
                      background: cartTotalItems > 0 ? '#6366f1' : '#1e293b',
                      borderRadius: '0.5rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.8rem', fontWeight: 700, color: 'white',
                      transition: 'background 0.2s',
                    }}>
                      {cartTotalItems}
                    </div>
                    <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.95rem' }}>Your Order</span>
                    {cartTotalItems > 0 && (
                      <span style={{ color: '#818cf8', fontSize: '0.75rem', fontWeight: 600 }}>
                        ₹{cartTotalPrice.toFixed(2)} • {cartTotalItems} item{cartTotalItems > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <span style={{ color: '#64748b', fontSize: '1rem', transform: cartOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s', display: 'inline-block' }}>▲</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
