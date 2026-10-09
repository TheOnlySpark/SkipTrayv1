import React, { useState, useEffect } from "react";
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { Database } from '../types/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconStar } from '../components/Icons';

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
        .eq('tenant_id', currentTenantId)
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
      const functionsUrl = import.meta.env.VITE_SUPABASE_URL
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

  // --- NEW MODULES: FEEDBACK & REVIEWS and ANALYTICS ---

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [reviewCanteenFilter, setReviewCanteenFilter] = useState<string>('ALL');

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['uniAdminReviews', currentTenantId, reviewCanteenFilter],
    enabled: !!currentTenantId,
    queryFn: async () => {
      let query = supabase
        .from('item_reviews')
        .select(`
          *,
          menu_items!inner (name, canteen_id, tenant_id, canteens(name)),
          profiles (name, id_number),
          orders (id, order_number)
        `)
        .eq('menu_items.tenant_id', currentTenantId)
        .order('created_at', { ascending: false });

      if (reviewCanteenFilter !== 'ALL') {
         query = query.eq('menu_items.canteen_id', reviewCanteenFilter);
      }
      
      const { data, error } = await query;
      if (error) console.error("Error fetching reviews:", error);
      return (data as any[]) || [];
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
      showAlert({ title: 'Reply Failed', message: 'Failed to submit reply.', type: 'error' });
    } else {
      setReplyingTo(null);
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['uniAdminReviews'] });
      showAlert({ title: 'Reply Published', message: 'Reply submitted.', type: 'success' });
    }
    setSubmittingReply(false);
  };

  const [analyticsCanteenFilter, setAnalyticsCanteenFilter] = useState<string>('ALL');
  const { data: analytics = { mostSold: [] }, isLoading: analyticsLoading } = useQuery({
    queryKey: ['uniAdminAnalytics', currentTenantId, analyticsCanteenFilter],
    enabled: !!currentTenantId,
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      let query = supabase
        .from('orders')
        .select(`
          status,
          order_items (
            quantity,
            menu_items (name)
          )
        `)
        .eq('tenant_id', currentTenantId)
        .gte('created_at', startDate.toISOString())
        .neq('status', 'REJECTED');

      if (analyticsCanteenFilter !== 'ALL') {
        query = query.eq('canteen_id', analyticsCanteenFilter);
      }

      const { data } = await query;
      const itemCounts: Record<string, number> = {};

      if (data) {
        data.forEach(order => {
          order.order_items?.forEach((item: any) => {
            const name = item.menu_items?.name;
            if (name) {
              itemCounts[name] = (itemCounts[name] || 0) + item.quantity;
            }
          });
        });
      }

      const mostSold = Object.entries(itemCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return { mostSold };
    }
  });

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

      {/* Analytics Section */}
      <div className="bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 shadow-sm flex flex-col">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            Weekly Analytics
          </h2>
          <select 
            value={analyticsCanteenFilter} 
            onChange={e => setAnalyticsCanteenFilter(e.target.value)}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Canteens</option>
            {canteens.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {analyticsLoading ? (
          <div className="text-slate-500 text-sm">Loading analytics...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-50 rounded-2xl p-6 shadow-sm border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-4 uppercase tracking-wider text-xs">Most Sold This Week</h3>
              {analytics.mostSold.length === 0 ? (
                <div className="text-slate-500 text-sm">No sales data for this week.</div>
              ) : (
                <div className="space-y-4 mt-2">
                  {analytics.mostSold.map((item, idx) => {
                    const maxCount = Math.max(...analytics.mostSold.map(i => i.count), 1);
                    const percentage = Math.round((item.count / maxCount) * 100);
                    return (
                      <div key={idx} className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-slate-700 flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold bg-slate-200 text-slate-600">
                              {idx + 1}
                            </span>
                            {item.name}
                          </span>
                          <span className="text-indigo-600">{item.count} sold</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200/50">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${idx === 0 ? 'bg-indigo-600' :
                                idx === 1 ? 'bg-indigo-500' :
                                  idx === 2 ? 'bg-indigo-400' : 'bg-indigo-300'
                              }`}
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-indigo-600 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-center text-white text-center">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"></path></svg>
              </div>
              <h3 className="font-bold text-xl mb-1">Great Job!</h3>
              <p className="text-indigo-200 text-sm">Keep up the good work managing operations.</p>
            </div>
          </div>
        )}
      </div>

      {/* Feedback & Reviews */}
      <div className="bg-white border border-slate-200 rounded-[2rem] p-5 sm:p-8 shadow-sm flex flex-col">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <h2 className="text-xl font-bold text-slate-800">Student Feedback & Reviews</h2>
          <select 
            value={reviewCanteenFilter} 
            onChange={e => setReviewCanteenFilter(e.target.value)}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Canteens</option>
            {canteens.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {reviewsLoading ? (
          <div className="text-slate-500 text-sm">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="text-slate-500 text-sm py-4">No reviews yet.</div>
        ) : (
          <div className="flex flex-col gap-4 flex-1 max-h-[600px] overflow-y-auto pr-2">
            {reviews.map(review => (
              <div key={review.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col gap-3 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-800">
                      {review.orders?.order_number ? `Order #${review.orders.order_number} - ` : ''}
                      {review.menu_items?.name || 'Unknown Item'}
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {review.menu_items?.canteens?.name && <span className="font-bold text-indigo-600">{review.menu_items.canteens.name} • </span>}
                      {review.orders?.id && <span className="font-mono">ID: {review.orders.id.split('-')[0].toUpperCase()} • </span>}
                      By {review.profiles?.name || 'Unknown'} ({review.profiles?.id_number || 'No ID'})
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <IconStar 
                        key={i} 
                        size={16} 
                        className={`w-4 h-4 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`} 
                        filled={i < review.rating} 
                      />
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
