import React from 'react';
import { X, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface CancellationStatusModalProps {
  request: any;
  order: any;
  onClose: () => void;
}

export function CancellationStatusModal({ request, order, onClose }: CancellationStatusModalProps) {
  if (!request) return null;

  const displayId = `#CR-${request.id.slice(0, 8).toUpperCase()}`;

  const getStatusBadge = (status: string, type: 'cancel' | 'refund') => {
    switch (status) {
      case 'APPROVED':
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle size={13} /> {status}
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
            <RefreshCw size={13} className="animate-spin" /> PROCESSING
          </span>
        );
      case 'UNDER_REVIEW':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            <Clock size={13} /> UNDER REVIEW
          </span>
        );
      case 'REJECTED':
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
            <XCircle size={13} /> {status}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
            <AlertCircle size={13} /> {status}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden my-8">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
                {displayId}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                Order #{order?.order_number || request.order_id?.slice(0, 8)}
              </span>
            </div>
            <h2 className="text-lg font-black text-slate-800 mt-1">
              Cancellation & Refund Request Status
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

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          
          {/* Status Overview Card */}
          <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Cancellation Status
              </p>
              {getStatusBadge(request.cancellation_status, 'cancel')}
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Refund Status
              </p>
              {getStatusBadge(request.refund_status, 'refund')}
            </div>
          </div>

          {/* Amount Overview */}
          <div className="flex justify-between items-center p-4 bg-indigo-50/60 rounded-2xl border border-indigo-100">
            <div>
              <p className="text-xs text-indigo-900 font-medium">Refund Amount Requested</p>
              <p className="text-lg font-black text-indigo-700">₹{Number(request.requested_refund_amount || 0).toFixed(2)}</p>
            </div>
            {request.approved_refund_amount > 0 && (
              <div className="text-right">
                <p className="text-xs text-emerald-900 font-medium">Approved Refund Amount</p>
                <p className="text-lg font-black text-emerald-700">₹{Number(request.approved_refund_amount).toFixed(2)}</p>
              </div>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Reason Provided
            </p>
            <p className="p-3 bg-slate-50 rounded-xl text-slate-700 border border-slate-200 text-xs leading-relaxed">
              {request.cancellation_reason}
            </p>
          </div>

          {/* Admin Remarks */}
          {request.review_remarks && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Administrator Remarks
              </p>
              <p className="p-3 bg-amber-50/60 rounded-xl text-amber-900 border border-amber-200 text-xs leading-relaxed">
                {request.review_remarks}
              </p>
            </div>
          )}

          {/* Transaction Reference if processed */}
          {request.refund_transaction_id && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between items-center">
              <span className="text-slate-500 font-medium">Payment Reference ID:</span>
              <span className="font-mono font-bold text-slate-800">{request.refund_transaction_id}</span>
            </div>
          )}

          {/* Submission Timestamp */}
          <div className="text-[11px] text-slate-400 text-right">
            Submitted on: {new Date(request.created_at).toLocaleString()}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors shadow-sm"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
