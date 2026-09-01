import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';

type Order = Database['public']['Tables']['orders']['Row'];
type OrderItem = Database['public']['Tables']['order_items']['Row'];
type MenuItem = Database['public']['Tables']['menu_items']['Row'];

// Extended Order type to include joined data (student name, items)
type OrderWithDetails = Order & {
  profiles: { name: string, id_number: string } | null;
  order_items: (OrderItem & { menu_items: MenuItem | null })[];
};

export default function StaffDashboard() {
  const { profile, signOut } = useAuth();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  // OTP Verification state
  const [selectedOrderForOtp, setSelectedOrderForOtp] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState('');

  useEffect(() => {
    fetchOrders();
    fetchMenu();

    // Realtime subscriptions
    const orderSub = supabase.channel('staff_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        // Re-fetch everything to ensure we get joined data easily. 
        // In a highly optimized app, we'd update the specific order in state.
        fetchOrders();
      })
      .subscribe();

    const menuSub = supabase.channel('staff_menu')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
        fetchMenu();
      })
      .subscribe();

    return () => {
      orderSub.unsubscribe();
      menuSub.unsubscribe();
    };
  }, []);

  const fetchMenu = async () => {
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .order('veg_non_veg', { ascending: false })
      .order('name');
    if (data) {
      const sorted = [...data].sort((a, b) => {
        if (a.veg_non_veg !== b.veg_non_veg) {
          return a.veg_non_veg === 'VEG' ? -1 : 1;
        }
        if (a.name.toLowerCase() === 'veg meals') return -1;
        if (b.name.toLowerCase() === 'veg meals') return 1;
        return a.name.localeCompare(b.name);
      });
      setMenuItems(sorted);
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        profiles ( name, id_number ),
        order_items (
          *,
          menu_items ( * )
        )
      `)
      .in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])
      .order('pickup_time', { ascending: true });
      
    if (data) setOrders(data as OrderWithDetails[]);
    setLoading(false);
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    // Optimistic update for instant UI feedback
    setOrders(prev => prev.map(order => 
      order.id === orderId ? { ...order, status: status as any } : order
    ));

    const { error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_status: status as any
    });

    if (error) {
      if (import.meta.env.DEV) console.error("Failed to update order status:", error);
      alert("Failed to update order status. Please try again.");
      // Revert by re-fetching orders
      fetchOrders();
    }
  };

  const handleToggleSoldOut = async (id: string, currentStatus: boolean) => {
    // Optimistic update for instant UI feedback
    setMenuItems(prev => prev.map(item => 
      item.id === id ? { ...item, is_sold_out: !currentStatus } : item
    ));

    const { error } = await supabase.rpc('toggle_sold_out', {
      item_id: id,
      new_status: !currentStatus
    });

    if (error) {
      // Revert on error
      setMenuItems(prev => prev.map(item => 
        item.id === id ? { ...item, is_sold_out: currentStatus } : item
      ));
      if (import.meta.env.DEV) console.error("Failed to toggle sold out status", error);
    }
  };

  const handleVerifyOtp = async (orderId: string) => {
    const { data, error } = await supabase.rpc('verify_pickup_otp', {
      p_order_id: orderId,
      p_otp: otpInput
    });

    if (error) {
      alert('Verification failed. Please try again.');
      return;
    }

    const result = data as any;
    if (result.success) {
      setSelectedOrderForOtp(null);
      setOtpInput('');
      fetchOrders();
    } else {
      if (result.requires_override) {
        if (window.confirm(result.message + "\n\nDo you want to manually override?")) {
          await supabase.rpc('verify_pickup_otp', {
            p_order_id: orderId,
            p_otp: '',
            p_is_override: true
          });
          setSelectedOrderForOtp(null);
          setOtpInput('');
          fetchOrders();
        }
      } else {
        alert(result.message);
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PLACED': return 'bg-slate-800 text-slate-300 border-slate-700';
      case 'ACCEPTED': return 'bg-blue-900 text-blue-300 border-blue-800';
      case 'PREPARING': return 'bg-orange-900 text-orange-300 border-orange-800';
      case 'READY': return 'bg-green-900 text-green-300 border-green-800';
      default: return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="w-full max-w-5xl grid grid-cols-12 gap-4">
      {/* Header */}
      <div className="col-span-12 bg-slate-900 rounded-[2rem] p-5 sm:p-8 text-white flex flex-col relative overflow-hidden mb-4">
        <div className="z-10 flex flex-col sm:flex-row justify-between items-start gap-6 sm:gap-4">
          <div>
            <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-500/30">Staff Portal</span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-4 leading-tight">Welcome, {profile?.name || 'Staff'}</h1>
          </div>
          <button onClick={signOut} className="w-full sm:w-auto text-center text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 px-4 py-3 sm:py-2 rounded-xl border border-slate-700 transition-colors">
            Sign Out
          </button>
        </div>
      </div>

      {/* Live Order Queue */}
      <div className="col-span-12 space-y-4">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Live Order Queue</h2>
        {loading && orders.length === 0 ? (
          <div className="text-slate-500">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 text-center text-slate-500 shadow-sm">
            No active orders.
          </div>
        ) : (
          orders.map(order => (
            <div key={order.id} className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm flex flex-col">
              <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-2 mb-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Order #{order.order_number} - {order.profiles?.name} <span className="text-sm font-normal text-slate-500">({order.profiles?.id_number})</span></h3>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">ID: {order.id.split('-')[0].toUpperCase()}</div>
                  <div className="text-sm font-semibold text-indigo-600 mt-1">Pickup: {order.pickup_time}</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusColor(order.status)}`}>
                  {order.status}
                </div>
              </div>
              
              <div className="flex-grow mb-4">
                <ul className="space-y-2">
                  {order.order_items.map(item => (
                    <li key={item.id} className="text-sm flex justify-between items-center">
                      <span className="text-slate-700"><span className="font-bold text-slate-900">{item.quantity}x</span> {item.menu_items?.name}</span>
                      {item.menu_items?.price !== undefined && item.menu_items?.price !== null && (
                        <span className="text-xs font-semibold text-slate-500">
                          ₹{(Number(item.menu_items.price) * item.quantity).toFixed(2)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 pt-2 border-t border-dashed border-slate-200 flex justify-between items-center text-xs font-bold text-slate-700">
                  <span>Total Value</span>
                  <span className="text-indigo-600 font-extrabold text-sm">
                    ₹{order.order_items.reduce((sum, item) => sum + (Number(item.menu_items?.price || 0) * item.quantity), 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Action Buttons based on status */}
              <div className="flex gap-2 mt-auto pt-4 border-t border-slate-100">
                {order.status === 'PLACED' && (
                  <>
                    <button onClick={() => updateOrderStatus(order.id, 'ACCEPTED')} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl text-sm font-semibold transition-colors">Accept</button>
                    <button onClick={() => updateOrderStatus(order.id, 'REJECTED')} className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 py-2 rounded-xl text-sm font-semibold transition-colors">Reject</button>
                  </>
                )}
                {order.status === 'ACCEPTED' && (
                  <button onClick={() => updateOrderStatus(order.id, 'PREPARING')} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-xl text-sm font-semibold transition-colors">Mark Preparing</button>
                )}
                {order.status === 'PREPARING' && (
                  <button onClick={() => updateOrderStatus(order.id, 'READY')} className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded-xl text-sm font-semibold transition-colors">Mark Ready</button>
                )}
                {order.status === 'READY' && (
                  <div className="flex-1 flex gap-2">
                    {selectedOrderForOtp === order.id ? (
                      <div className="flex flex-1 gap-2">
                        <input 
                          type="text" 
                          placeholder="OTP" 
                          value={otpInput}
                          onChange={(e) => setOtpInput(e.target.value)}
                          autoComplete="off"
                          maxLength={6}
                          className="w-24 px-3 py-2 border border-slate-300 rounded-xl text-center font-mono tracking-widest focus:ring-2 focus:ring-indigo-500 text-slate-900"
                        />
                        <button onClick={() => handleVerifyOtp(order.id)} className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-semibold hover:bg-slate-800">Verify & Collect</button>
                        <button onClick={() => { setSelectedOrderForOtp(null); setOtpInput(''); }} className="px-3 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200">X</button>
                      </div>
                    ) : (
                      <button onClick={() => setSelectedOrderForOtp(order.id)} className="flex-1 bg-slate-900 hover:bg-slate-800 text-white py-2 rounded-xl text-sm font-semibold transition-colors">Verify OTP</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quick Menu Toggles */}
      <div className="col-span-12 bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm mt-4">
        <h3 className="font-extrabold text-2xl text-slate-800 mb-6 text-center">Quick Availability</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-h-[500px] overflow-y-auto pr-2 place-items-stretch">
          {menuItems.map(item => (
            <div key={item.id} className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm text-center">
              <span className={`text-base font-bold mb-1 ${item.is_sold_out ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{item.name}</span>
              <span className="text-xs font-bold text-indigo-600 mb-3">₹{Number(item.price || 0).toFixed(2)}</span>
              <button 
                onClick={() => handleToggleSoldOut(item.id, item.is_sold_out)}
                className={`w-full max-w-[120px] text-sm px-4 py-2 rounded-xl font-bold transition-transform active:scale-95 ${item.is_sold_out ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
              >
                {item.is_sold_out ? 'Available' : 'Sold Out'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
