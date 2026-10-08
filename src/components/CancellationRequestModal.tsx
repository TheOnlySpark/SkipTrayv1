import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/ModalDialogContext';
import { useQueryClient } from '@tanstack/react-query';
import { X, AlertTriangle, ShieldCheck, ShieldAlert, CheckSquare, Square, Info } from 'lucide-react';

interface CancellationRequestModalProps {
  order: any;
  onClose: () => void;
}

const COMMON_REASONS = [
  'Schedule conflict / Class timing change',
  'Placed order by mistake',
  'Item selection / Dietary preference change',
  'Emergency / Had to leave campus early',
  'Cafeteria delay / Timing issue',
  'Other reason (please describe below)'
];

export function CancellationRequestModal({ order, onClose }: CancellationRequestModalProps) {
  const { profile } = useAuth();
  const { showAlert } = useDialog();
  const queryClient = useQueryClient();

  const [selectedReasonOption, setSelectedReasonOption] = useState(COMMON_REASONS[0]);
  const [customReasonDetails, setCustomReasonDetails] = useState('');
  const [confirmedPolicy, setConfirmedPolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Compute total order amount from order items
  const orderItems = order.order_items || [];
  const totalAmount = orderItems.reduce((acc: number, item: any) => {
    const price = Number(item.menu_items?.price ?? 0);
    return acc + (Number(item.quantity || 1) * price);
  }, 0);

  const strikes = profile?.strike_count || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!profile?.id || !profile?.tenant_id) {
      await showAlert({
        title: 'Authentication Required',
        message: 'Please ensure you are logged in to submit a cancellation request.',
        type: 'error'
      });
      return;
    }

    if (!confirmedPolicy) {
      await showAlert({
        title: 'Confirmation Required',
        message: 'Please confirm that you have read and agree to the cancellation policy.',
        type: 'warning'
      });
      return;
    }

    const fullReason = selectedReasonOption.includes('Other')
      ? customReasonDetails.trim()
      : `${selectedReasonOption}${customReasonDetails.trim() ? `: ${customReasonDetails.trim()}` : ''}`;

    if (!fullReason.trim()) {
      await showAlert({
        title: 'Reason Required',
        message: 'Please enter a reason explaining why you need to cancel this booking.',
        type: 'warning'
      });
      return;
    }

    setSubmitting(true);
    try {
      // 1. Verify no existing request exists for this order
      const { data: existing, error: checkError } = await supabase
        .from('cancellation_requests')
        .select('id, cancellation_status, refund_status')
        .eq('order_id', order.id)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existing) {
        await showAlert({
          title: 'Request Already Exists',
          message: `A cancellation request (#CR-${existing.id.slice(0, 8).toUpperCase()}) has already been submitted for this order. Current status: ${existing.cancellation_status}.`,
          type: 'info'
        });
        onClose();
        return;
      }

      // 2. Insert new cancellation request
      const { data: inserted, error: insertError } = await supabase
        .from('cancellation_requests')
        .insert({
          order_id: order.id,
          user_id: profile.id,
          tenant_id: profile.tenant_id,
          cancellation_reason: fullReason,
          strike_status_snapshot: strikes,
          requested_refund_amount: totalAmount,
          approved_refund_amount: 0,
          cancellation_status: 'REQUESTED',
          refund_status: 'REQUESTED'
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      // 3. Append immutable audit log
      if (inserted?.id) {
        await supabase.from('cancellation_audit_logs').insert({
          request_id: inserted.id,
          actor_id: profile.id,
          tenant_id: profile.tenant_id,
          action: 'REQUEST_SUBMITTED',
          details: {
            order_number: order.order_number,
            order_id: order.id,
            requested_amount: totalAmount,
            reason: fullReason,
            strike_snapshot: strikes,
            submitted_at: new Date().toISOString()
          }
        });
      }

      const displayId = inserted?.id ? `#CR-${inserted.id.slice(0, 8).toUpperCase()}` : '';

      await showAlert({
        title: 'Request Submitted Successfully',
        message: `Your cancellation and refund request (${displayId}) has been received. Your university administrator and cafeteria manager will review it. You can monitor progress under Order History.`,
        type: 'success'
      });

      queryClient.invalidateQueries({ queryKey: ['pastOrders'] });
      queryClient.invalidateQueries({ queryKey: ['cancellation_requests'] });
      queryClient.invalidateQueries({ queryKey: ['userCancellationRequests'] });
      onClose();
    } catch (err: any) {
      console.error('Failed to submit cancellation request:', err);
      await showAlert({
        title: 'Submission Failed',
        message: err.message || 'An error occurred while submitting your request. Please try again.',
        type: 'error'
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl border border-slate-100 overflow-hidden my-8">
        
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                Cancellation Request
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Order #{order.order_number}
              </span>
            </div>
            <h2 className="text-xl font-black text-slate-800 mt-1">
              Request Order Cancellation & Refund
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          
          {/* Order Summary Box */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm space-y-2">
            <div className="flex justify-between items-center text-slate-500 font-medium text-xs">
              <span>Cafeteria: <strong>{order.canteens?.name || 'Main Canteen'}</strong></span>
              <span>Pickup Slot: <strong>{order.pickup_time}</strong></span>
            </div>
            <div className="border-t border-slate-200/80 pt-2 space-y-1">
              {orderItems.map((oi: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center text-xs text-slate-700">
                  <span>
                    {oi.quantity}x {oi.menu_items?.name || 'Item'}
                  </span>
                  <span className="font-semibold text-slate-800">
                    ₹{((oi.quantity || 1) * Number(oi.menu_items?.price || 0)).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between items-center font-bold text-slate-900">
              <span>Total Payment Amount:</span>
              <span className="text-base text-indigo-600">₹{totalAmount.toFixed(2)}</span>
            </div>
          </div>

          {/* Cancellation Policy Banner */}
          <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
            <div className="text-xs text-amber-900 leading-relaxed">
              <strong className="block font-bold text-amber-950 mb-1">Cancellation & Refund Policy:</strong>
              <ul className="list-disc pl-4 space-y-1 text-amber-800">
                <li>Submitting a cancellation does <strong>not</strong> automatically issue a refund or cancel transactions.</li>
                <li>Each request is reviewed individually by authorized university administrators.</li>
                <li>Approved refunds are processed safely via payment gateway or institutional accounts.</li>
              </ul>
            </div>
          </div>

          {/* Strike Status Display */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {strikes > 0 ? (
                <>
                  <ShieldAlert size={18} className="text-amber-600 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-800">Account Strike Status: </span>
                    <span className="text-amber-700 font-semibold">{strikes} Active Strike(s)</span>
                  </div>
                </>
              ) : (
                <>
                  <ShieldCheck size={18} className="text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold text-slate-800">Account Strike Status: </span>
                    <span className="text-emerald-700 font-semibold">No Strikes (Good Standing)</span>
                  </div>
                </>
              )}
            </div>
            <span className="text-[11px] text-slate-400">
              Attached as review context
            </span>
          </div>

          {/* Reason Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Reason for Cancellation <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedReasonOption}
              onChange={(e) => setSelectedReasonOption(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {COMMON_REASONS.map((r, i) => (
                <option key={i} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Custom Details Textarea */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Additional Details / Explanation
            </label>
            <textarea
              value={customReasonDetails}
              onChange={(e) => setCustomReasonDetails(e.target.value)}
              placeholder="Provide specific details regarding your cancellation request..."
              rows={3}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Refund Amount Estimation */}
          <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-indigo-900 uppercase tracking-wider">Estimated Eligible Refund</p>
              <p className="text-[11px] text-indigo-700 mt-0.5">Subject to administrator review and fee deductions if applicable</p>
            </div>
            <div className="text-xl font-extrabold text-indigo-600">
              ₹{totalAmount.toFixed(2)}
            </div>
          </div>

          {/* Policy Confirmation Checkbox */}
          <div 
            onClick={() => setConfirmedPolicy(!confirmedPolicy)}
            className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors select-none"
          >
            <button
              type="button"
              className="mt-0.5 text-indigo-600 focus:outline-none"
              aria-label="Toggle confirmation"
            >
              {confirmedPolicy ? <CheckSquare size={18} /> : <Square size={18} className="text-slate-400" />}
            </button>
            <span className="text-xs text-slate-700 font-medium leading-relaxed">
              I understand and agree to the cancellation policy. I acknowledge that submitting this request does not guarantee an immediate or automatic refund.
            </span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl font-bold text-xs text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              Keep Booking
            </button>
            <button
              type="submit"
              disabled={submitting || !confirmedPolicy}
              className="px-6 py-2.5 rounded-xl font-bold text-xs text-white bg-red-600 hover:bg-red-700 active:scale-95 transition-all shadow-sm shadow-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting Request...' : 'Submit Cancellation Request'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
