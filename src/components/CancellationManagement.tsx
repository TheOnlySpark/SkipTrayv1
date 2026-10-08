import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useDialog } from '../contexts/ModalDialogContext';
import { useAuth } from '../contexts/AuthContext';
import { 
  CheckCircle, XCircle, Clock, AlertCircle, RefreshCw, Eye, Search, 
  ShieldAlert, ShieldCheck, ArrowUpDown, History, FileText, Check, X,
  Building, ChevronLeft, ChevronRight, AlertTriangle
} from 'lucide-react';

type CancellationRequest = Database['public']['Tables']['cancellation_requests']['Row'] & {
  orders: {
    id: string;
    order_number: number;
    pickup_time: string;
    status: string;
    created_at: string;
    payment_id: string | null;
    order_items?: {
      quantity: number;
      menu_items?: { name: string; price: number } | null;
    }[];
    canteens?: { name: string } | null;
  } | null;
  profiles: { name: string | null; id_number: string | null; strike_count: number } | null;
  tenants: { name: string; slug: string } | null;
  reviewer?: { name: string | null } | null;
  approver?: { name: string | null } | null;
  processor?: { name: string | null } | null;
};

type AuditLog = Database['public']['Tables']['cancellation_audit_logs']['Row'] & {
  actor?: { name: string | null; role: string } | null;
};

interface CancellationManagementProps {
  isSuperAdmin?: boolean;
}

export function CancellationManagement({ isSuperAdmin = false }: CancellationManagementProps) {
  const { showAlert } = useDialog();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  
  // Filters & State
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [cancellationStatusFilter, setCancellationStatusFilter] = useState('ALL');
  const [refundStatusFilter, setRefundStatusFilter] = useState('ALL');
  const [strikeFilter, setStrikeFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'DATE_DESC' | 'DATE_ASC' | 'AMOUNT_DESC' | 'AMOUNT_ASC' | 'STRIKES_DESC'>('DATE_DESC');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Active Modals
  const [activeDetailsRequest, setActiveDetailsRequest] = useState<CancellationRequest | null>(null);
  const [activeBookingOrder, setActiveBookingOrder] = useState<any | null>(null);
  const [reviewModalRequest, setReviewModalRequest] = useState<CancellationRequest | null>(null);
  const [approveModalRequest, setApproveModalRequest] = useState<CancellationRequest | null>(null);
  const [rejectModalRequest, setRejectModalRequest] = useState<CancellationRequest | null>(null);
  const [processingModalRequest, setProcessingModalRequest] = useState<CancellationRequest | null>(null);
  const [completeModalRequest, setCompleteModalRequest] = useState<CancellationRequest | null>(null);
  const [auditHistoryRequestId, setAuditHistoryRequestId] = useState<string | null>(null);

  // Form Inputs for Modals
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [reviewRecommendation, setReviewRecommendation] = useState<'RECOMMEND_APPROVE' | 'RECOMMEND_REJECT' | 'NEUTRAL'>('NEUTRAL');
  const [approvedAmountInput, setApprovedAmountInput] = useState<number>(0);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [processingNotes, setProcessingNotes] = useState('');
  const [verifiedCompletion, setVerifiedCompletion] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // 1. Fetch Tenants (for Super Admin filter)
  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenants').select('id, name').order('name');
      if (error) return [];
      return data || [];
    },
    enabled: isSuperAdmin
  });

  // 2. Fetch Requests
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['cancellation_requests', isSuperAdmin, profile?.tenant_id],
    queryFn: async () => {
      let query = supabase
        .from('cancellation_requests')
        .select(`
          *,
          orders (
            id, order_number, pickup_time, status, created_at, payment_id,
            canteens (name),
            order_items (
              quantity,
              menu_items (name, price)
            )
          ),
          profiles:user_id (name, id_number, strike_count),
          tenants (name, slug),
          reviewer:reviewed_by (name),
          approver:approved_by (name),
          processor:processed_by (name)
        `)
        .order('created_at', { ascending: false });

      if (!isSuperAdmin && profile?.tenant_id) {
        query = query.eq('tenant_id', profile.tenant_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as CancellationRequest[]) || [];
    }
  });

  // 3. Fetch Audit Logs for active request
  const { data: auditLogs = [], isLoading: auditLogsLoading } = useQuery({
    queryKey: ['cancellation_audit_logs', auditHistoryRequestId],
    queryFn: async () => {
      if (!auditHistoryRequestId) return [];
      const { data, error } = await supabase
        .from('cancellation_audit_logs')
        .select(`
          *,
          actor:actor_id (name, role)
        `)
        .eq('request_id', auditHistoryRequestId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data as unknown as AuditLog[]) || [];
    },
    enabled: !!auditHistoryRequestId
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(amount);
  };

  const logAudit = async (requestId: string, action: string, details: any = {}) => {
    if (!profile?.id) return;
    try {
      await supabase.from('cancellation_audit_logs').insert({
        request_id: requestId,
        actor_id: profile.id,
        tenant_id: profile.tenant_id,
        action: action,
        details: {
          ...details,
          actor_name: profile.name,
          actor_role: profile.role,
          timestamp: new Date().toISOString()
        }
      });
    } catch (e) {
      console.error('Failed to append audit log:', e);
    }
  };

  const getOrderTotal = (r: CancellationRequest) => {
    if (!r.orders?.order_items) return Number(r.requested_refund_amount || 0);
    const itemsTotal = r.orders.order_items.reduce((sum, item) => {
      const price = Number(item.menu_items?.price || 0);
      return sum + (Number(item.quantity || 1) * price);
    }, 0);
    return itemsTotal > 0 ? itemsTotal : Number(r.requested_refund_amount || 0);
  };

  // 4. Filtered & Sorted Requests
  const filteredRequests = useMemo(() => {
    let result = requests.filter((r) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesName = r.profiles?.name?.toLowerCase().includes(term);
        const matchesIdNumber = r.profiles?.id_number?.toLowerCase().includes(term);
        const matchesOrderNumber = r.orders?.order_number?.toString().includes(term);
        const matchesRequestId = r.id.toLowerCase().includes(term);
        const matchesReason = r.cancellation_reason.toLowerCase().includes(term);
        const matchesTenant = r.tenants?.name?.toLowerCase().includes(term);
        if (!matchesName && !matchesIdNumber && !matchesOrderNumber && !matchesRequestId && !matchesReason && !matchesTenant) {
          return false;
        }
      }

      if (isSuperAdmin && tenantFilter !== 'ALL') {
        if (r.tenant_id !== tenantFilter) return false;
      }

      if (cancellationStatusFilter !== 'ALL' && r.cancellation_status !== cancellationStatusFilter) {
        return false;
      }

      if (refundStatusFilter !== 'ALL' && r.refund_status !== refundStatusFilter) {
        return false;
      }

      if (strikeFilter === 'NO_STRIKE' && r.strike_status_snapshot > 0) return false;
      if (strikeFilter === 'WITH_STRIKES' && r.strike_status_snapshot === 0) return false;

      if (dateFilter !== 'ALL') {
        const reqDate = new Date(r.created_at);
        const now = new Date();
        if (dateFilter === 'TODAY') {
          if (reqDate.toDateString() !== now.toDateString()) return false;
        } else if (dateFilter === 'LAST_7_DAYS') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(now.getDate() - 7);
          if (reqDate < sevenDaysAgo) return false;
        } else if (dateFilter === 'LAST_30_DAYS') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(now.getDate() - 30);
          if (reqDate < thirtyDaysAgo) return false;
        }
      }

      return true;
    });

    result.sort((a, b) => {
      if (sortBy === 'DATE_DESC') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'DATE_ASC') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === 'AMOUNT_DESC') return Number(b.requested_refund_amount || 0) - Number(a.requested_refund_amount || 0);
      if (sortBy === 'AMOUNT_ASC') return Number(a.requested_refund_amount || 0) - Number(b.requested_refund_amount || 0);
      if (sortBy === 'STRIKES_DESC') return Number(b.strike_status_snapshot || 0) - Number(a.strike_status_snapshot || 0);
      return 0;
    });

    return result;
  }, [requests, searchTerm, tenantFilter, cancellationStatusFilter, refundStatusFilter, strikeFilter, dateFilter, sortBy, isSuperAdmin]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const paginatedRequests = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredRequests.slice(startIndex, startIndex + pageSize);
  }, [filteredRequests, currentPage, pageSize]);

  // 5. Summary Metrics (from real records)
  const totalCancellations = requests.length;
  const pendingRefunds = requests.filter(r => ['REQUESTED', 'UNDER_REVIEW'].includes(r.refund_status)).length;
  const approvedRefunds = requests.filter(r => r.refund_status === 'APPROVED').length;
  const processingRefunds = requests.filter(r => r.refund_status === 'PROCESSING').length;
  const completedRefunds = requests.filter(r => r.refund_status === 'COMPLETED').length;
  const rejectedRefunds = requests.filter(r => r.refund_status === 'REJECTED').length;
  const totalAmountRequested = requests.reduce((sum, r) => sum + Number(r.requested_refund_amount || 0), 0);
  const totalAmountRefunded = requests
    .filter(r => r.refund_status === 'COMPLETED')
    .reduce((sum, r) => sum + Number(r.approved_refund_amount || 0), 0);

  const renderRefundBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle size={12} /> COMPLETED
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
            <RefreshCw size={12} className="animate-spin" /> PROCESSING
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">
            <Check size={12} /> APPROVED
          </span>
        );
      case 'UNDER_REVIEW':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
            <Clock size={12} /> UNDER REVIEW
          </span>
        );
      case 'REJECTED':
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
            <XCircle size={12} /> {status}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
            <AlertCircle size={12} /> {status}
          </span>
        );
    }
  };

  const renderCancelBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">APPROVED</span>;
      case 'UNDER_REVIEW':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">UNDER REVIEW</span>;
      case 'REJECTED':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">REJECTED</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  // Actions
  const handleOpenReview = (r: CancellationRequest) => {
    setReviewModalRequest(r);
    setReviewRemarks(r.review_remarks || '');
    setReviewRecommendation((r.recommendation as any) || 'NEUTRAL');
  };

  const handleSubmitReview = async () => {
    if (!reviewModalRequest) return;
    setActionLoading(true);
    try {
      const isUnderReview = reviewModalRequest.cancellation_status === 'REQUESTED';
      const newCancelStatus = isUnderReview ? 'UNDER_REVIEW' : reviewModalRequest.cancellation_status;
      const newRefundStatus = reviewModalRequest.refund_status === 'REQUESTED' ? 'UNDER_REVIEW' : reviewModalRequest.refund_status;

      const { error } = await supabase
        .from('cancellation_requests')
        .update({
          reviewed_by: profile?.id,
          reviewed_at: new Date().toISOString(),
          review_remarks: reviewRemarks.trim() || null,
          recommendation: reviewRecommendation,
          cancellation_status: newCancelStatus,
          refund_status: newRefundStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', reviewModalRequest.id);

      if (error) throw error;

      await logAudit(reviewModalRequest.id, 'REVIEW_UPDATED', {
        remarks: reviewRemarks.trim(),
        recommendation: reviewRecommendation,
        cancellation_status: newCancelStatus,
        refund_status: newRefundStatus
      });

      queryClient.invalidateQueries({ queryKey: ['cancellation_requests'] });
      setReviewModalRequest(null);
      await showAlert({
        title: 'Review Submitted',
        message: 'Internal review remarks and recommendation have been recorded.',
        type: 'success'
      });
    } catch (err: any) {
      await showAlert({
        title: 'Review Failed',
        message: err.message || 'Failed to submit review.',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenApprove = (r: CancellationRequest) => {
    setApproveModalRequest(r);
    setApprovedAmountInput(Number(r.requested_refund_amount || 0));
    setApprovalNotes('');
  };

  const handleConfirmApproval = async () => {
    if (!approveModalRequest) return;
    const maxEligible = getOrderTotal(approveModalRequest);

    if (approvedAmountInput <= 0) {
      await showAlert({
        title: 'Invalid Amount',
        message: 'Approved refund amount must be greater than zero.',
        type: 'warning'
      });
      return;
    }

    if (approvedAmountInput > maxEligible) {
      await showAlert({
        title: 'Amount Exceeds Maximum',
        message: `Approved amount (₹${approvedAmountInput.toFixed(2)}) cannot exceed total order value (₹${maxEligible.toFixed(2)}).`,
        type: 'warning'
      });
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('cancellation_requests')
        .update({
          approved_by: profile?.id,
          approved_at: new Date().toISOString(),
          approved_refund_amount: approvedAmountInput,
          cancellation_status: 'APPROVED',
          refund_status: 'APPROVED',
          review_remarks: approvalNotes.trim() ? approvalNotes.trim() : approveModalRequest.review_remarks,
          updated_at: new Date().toISOString()
        })
        .eq('id', approveModalRequest.id);

      if (error) throw error;

      await supabase
        .from('orders')
        .update({ status: 'CANCELLED' as any })
        .eq('id', approveModalRequest.order_id);

      await logAudit(approveModalRequest.id, 'REFUND_APPROVED', {
        approved_amount: approvedAmountInput,
        notes: approvalNotes.trim(),
        approver_id: profile?.id
      });

      queryClient.invalidateQueries({ queryKey: ['cancellation_requests'] });
      setApproveModalRequest(null);
      await showAlert({
        title: 'Refund Approved',
        message: `Refund of ₹${approvedAmountInput.toFixed(2)} has been authorized. Note: Payment transaction has NOT been processed yet; proceed to Payment Processing when ready.`,
        type: 'success'
      });
    } catch (err: any) {
      await showAlert({
        title: 'Approval Failed',
        message: err.message || 'Failed to approve refund request.',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenReject = (r: CancellationRequest) => {
    setRejectModalRequest(r);
    setRejectionReason('');
  };

  const handleConfirmRejection = async () => {
    if (!rejectModalRequest) return;
    if (!rejectionReason.trim()) {
      await showAlert({
        title: 'Rejection Reason Mandatory',
        message: 'A clear reason for rejecting the request is required.',
        type: 'warning'
      });
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('cancellation_requests')
        .update({
          reviewed_by: profile?.id,
          reviewed_at: new Date().toISOString(),
          review_remarks: rejectionReason.trim(),
          cancellation_status: 'REJECTED',
          refund_status: 'REJECTED',
          updated_at: new Date().toISOString()
        })
        .eq('id', rejectModalRequest.id);

      if (error) throw error;

      await logAudit(rejectModalRequest.id, 'REQUEST_REJECTED', {
        rejection_reason: rejectionReason.trim(),
        reviewer_id: profile?.id
      });

      queryClient.invalidateQueries({ queryKey: ['cancellation_requests'] });
      setRejectModalRequest(null);
      await showAlert({
        title: 'Request Rejected',
        message: 'The request has been marked as REJECTED with the provided explanation.',
        type: 'info'
      });
    } catch (err: any) {
      await showAlert({
        title: 'Rejection Failed',
        message: err.message || 'Failed to reject request.',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenProcessing = (r: CancellationRequest) => {
    setProcessingModalRequest(r);
    setTransactionRef(`TXN-REF-${r.id.slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`);
    setProcessingNotes('');
  };

  const handleConfirmProcessing = async () => {
    if (!processingModalRequest) return;
    if (!transactionRef.trim()) {
      await showAlert({
        title: 'Reference Required',
        message: 'Please provide a payment gateway or disbursement transaction reference number.',
        type: 'warning'
      });
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('cancellation_requests')
        .update({
          processed_by: profile?.id,
          processed_at: new Date().toISOString(),
          refund_transaction_id: transactionRef.trim(),
          refund_status: 'PROCESSING',
          updated_at: new Date().toISOString()
        })
        .eq('id', processingModalRequest.id);

      if (error) throw error;

      await logAudit(processingModalRequest.id, 'PAYMENT_PROCESSING_INITIATED', {
        transaction_id: transactionRef.trim(),
        notes: processingNotes.trim(),
        processor_id: profile?.id
      });

      queryClient.invalidateQueries({ queryKey: ['cancellation_requests'] });
      setProcessingModalRequest(null);
      await showAlert({
        title: 'Refund Marked as Processing',
        message: 'The refund has been recorded as actively processing with reference ID: ' + transactionRef,
        type: 'info'
      });
    } catch (err: any) {
      await showAlert({
        title: 'Update Failed',
        message: err.message || 'Failed to mark refund as processing.',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenComplete = (r: CancellationRequest) => {
    setCompleteModalRequest(r);
    setVerifiedCompletion(false);
  };

  const handleConfirmCompletion = async () => {
    if (!completeModalRequest) return;
    if (!verifiedCompletion) {
      await showAlert({
        title: 'Verification Required',
        message: 'Please check the box confirming that payment settlement or disbursement was verified.',
        type: 'warning'
      });
      return;
    }

    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('cancellation_requests')
        .update({
          refund_status: 'COMPLETED',
          processed_by: profile?.id,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', completeModalRequest.id);

      if (error) throw error;

      await logAudit(completeModalRequest.id, 'REFUND_COMPLETED_VERIFIED', {
        approved_amount: completeModalRequest.approved_refund_amount,
        transaction_id: completeModalRequest.refund_transaction_id,
        completed_by: profile?.id
      });

      queryClient.invalidateQueries({ queryKey: ['cancellation_requests'] });
      setCompleteModalRequest(null);
      await showAlert({
        title: 'Refund Completed',
        message: 'Refund has been successfully verified and marked as COMPLETED.',
        type: 'success'
      });
    } catch (err: any) {
      await showAlert({
        title: 'Completion Failed',
        message: err.message || 'Failed to complete refund.',
        type: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      
      {/* ── Summary Cards Grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
        
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-1">Total Requests</p>
          <p className="text-2xl font-black text-slate-900">{totalCancellations}</p>
          <span className="text-[10px] text-slate-400 mt-1 font-medium">All recorded</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <p className="text-[11px] text-amber-600 font-bold uppercase tracking-wider mb-1">Pending Review</p>
          <p className="text-2xl font-black text-amber-600">{pendingRefunds}</p>
          <span className="text-[10px] text-slate-400 mt-1 font-medium">Awaiting action</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <p className="text-[11px] text-indigo-600 font-bold uppercase tracking-wider mb-1">Approved</p>
          <p className="text-2xl font-black text-indigo-600">{approvedRefunds}</p>
          <span className="text-[10px] text-slate-400 mt-1 font-medium">Ready for payout</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <p className="text-[11px] text-blue-600 font-bold uppercase tracking-wider mb-1">Processing</p>
          <p className="text-2xl font-black text-blue-600">{processingRefunds}</p>
          <span className="text-[10px] text-slate-400 mt-1 font-medium">In payout queue</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <p className="text-[11px] text-emerald-600 font-bold uppercase tracking-wider mb-1">Completed</p>
          <p className="text-2xl font-black text-emerald-600">{completedRefunds}</p>
          <span className="text-[10px] text-slate-400 mt-1 font-medium">Verified settled</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <p className="text-[11px] text-rose-600 font-bold uppercase tracking-wider mb-1">Rejected</p>
          <p className="text-2xl font-black text-rose-600">{rejectedRefunds}</p>
          <span className="text-[10px] text-slate-400 mt-1 font-medium">Declined</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between col-span-2 md:col-span-2 lg:col-span-2 bg-gradient-to-br from-indigo-50/50 to-white">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Total Requested</p>
              <p className="text-lg font-black text-indigo-700">{formatCurrency(totalAmountRequested)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Total Refunded</p>
              <p className="text-lg font-black text-emerald-700">{formatCurrency(totalAmountRefunded)}</p>
            </div>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 font-medium">Live transaction totals</span>
        </div>

      </div>

      {/* ── Main Table Card ───────────────────────────────────────────── */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        
        {/* Table Header & Controls */}
        <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Cancellation & Refund Management
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                {isSuperAdmin 
                  ? 'Super Admin global control plane — authorize, review, and process campus cancellation & refund requests.' 
                  : 'University Admin portal — review, add remarks, and recommend requests for your campus.'}
              </p>
            </div>

            {/* Global Search Bar */}
            <div className="relative w-full md:w-80">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search student, order #, request ID..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
            
            {isSuperAdmin && (
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
                <Building size={14} className="text-slate-400" />
                <select
                  value={tenantFilter}
                  onChange={(e) => { setTenantFilter(e.target.value); setCurrentPage(1); }}
                  className="bg-transparent font-semibold text-slate-700 focus:outline-none"
                >
                  <option value="ALL">All Universities</option>
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}

            <select
              value={cancellationStatusFilter}
              onChange={(e) => { setCancellationStatusFilter(e.target.value); setCurrentPage(1); }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-semibold text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Cancel Statuses</option>
              <option value="REQUESTED">Cancel: Requested</option>
              <option value="UNDER_REVIEW">Cancel: Under Review</option>
              <option value="APPROVED">Cancel: Approved</option>
              <option value="REJECTED">Cancel: Rejected</option>
              <option value="CANCELLED">Cancel: Cancelled</option>
            </select>

            <select
              value={refundStatusFilter}
              onChange={(e) => { setRefundStatusFilter(e.target.value); setCurrentPage(1); }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-semibold text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Refund Statuses</option>
              <option value="REQUESTED">Refund: Requested</option>
              <option value="UNDER_REVIEW">Refund: Under Review</option>
              <option value="APPROVED">Refund: Approved</option>
              <option value="PROCESSING">Refund: Processing</option>
              <option value="COMPLETED">Refund: Completed</option>
              <option value="REJECTED">Refund: Rejected</option>
            </select>

            <select
              value={strikeFilter}
              onChange={(e) => { setStrikeFilter(e.target.value); setCurrentPage(1); }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-semibold text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Strike Records</option>
              <option value="NO_STRIKE">No Strike (Clean Record)</option>
              <option value="WITH_STRIKES">Strike Marked (1+ Strikes)</option>
            </select>

            <select
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); setCurrentPage(1); }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-semibold text-slate-700 focus:outline-none"
            >
              <option value="ALL">All Time</option>
              <option value="TODAY">Today</option>
              <option value="LAST_7_DAYS">Last 7 Days</option>
              <option value="LAST_30_DAYS">Last 30 Days</option>
            </select>

            <div className="ml-auto flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <ArrowUpDown size={13} className="text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent font-semibold text-slate-700 focus:outline-none"
              >
                <option value="DATE_DESC">Newest First</option>
                <option value="DATE_ASC">Oldest First</option>
                <option value="AMOUNT_DESC">Amount: High to Low</option>
                <option value="AMOUNT_ASC">Amount: Low to High</option>
                <option value="STRIKES_DESC">Strikes: High to Low</option>
              </select>
            </div>

          </div>
        </div>

        {/* ── Table Content ─────────────────────────────────────────────── */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse min-w-[1250px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-black text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Request ID</th>
                <th className="py-3 px-4">Order / Booking</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Account ID</th>
                {isSuperAdmin && <th className="py-3 px-4">University</th>}
                <th className="py-3 px-4">Booking Date</th>
                <th className="py-3 px-4">Paid Total</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Strike Status</th>
                <th className="py-3 px-4">Refund Req.</th>
                <th className="py-3 px-4">Refund Status</th>
                <th className="py-3 px-4">Cancel Status</th>
                <th className="py-3 px-4">Request Date</th>
                <th className="py-3 px-4">Reviewed By</th>
                <th className="py-3 px-4">Admin Remarks</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 16 : 15} className="py-12 text-center text-slate-400">
                    <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading cancellation & refund records...
                  </td>
                </tr>
              ) : paginatedRequests.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 16 : 15} className="py-12 text-center text-slate-400">
                    <FileText size={32} className="mx-auto mb-2 text-slate-300" />
                    No cancellation or refund requests matching criteria.
                  </td>
                </tr>
              ) : (
                paginatedRequests.map((r) => {
                  const displayRequestId = `#CR-${r.id.slice(0, 8).toUpperCase()}`;
                  const orderNumber = r.orders?.order_number ? `#${r.orders.order_number}` : 'N/A';
                  const paidTotal = getOrderTotal(r);
                  const strikes = r.strike_status_snapshot;

                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      
                      <td className="py-3.5 px-4 font-mono font-bold text-indigo-600">
                        <button 
                          onClick={() => setActiveDetailsRequest(r)}
                          className="hover:underline flex items-center gap-1"
                          title="Click to view full details"
                        >
                          {displayRequestId}
                        </button>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                        <button
                          onClick={() => setActiveBookingOrder(r.orders)}
                          className="hover:underline text-slate-700 hover:text-indigo-600"
                          title="View order details"
                        >
                          {orderNumber}
                        </button>
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {r.profiles?.name || 'Unknown Student'}
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-500 text-[11px]">
                        {r.profiles?.id_number || r.user_id.slice(0, 8)}
                      </td>

                      {isSuperAdmin && (
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          {r.tenants?.name || 'N/A'}
                        </td>
                      )}

                      <td className="py-3.5 px-4 text-slate-500 text-[11px] whitespace-nowrap">
                        {r.orders?.created_at ? new Date(r.orders.created_at).toLocaleDateString() : 'N/A'}
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {formatCurrency(paidTotal)}
                      </td>

                      <td className="py-3.5 px-4 max-w-[200px] truncate text-slate-600" title={r.cancellation_reason}>
                        {r.cancellation_reason}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {strikes > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            <ShieldAlert size={12} className="text-amber-600" />
                            {strikes} Strike{strikes > 1 ? 's' : ''} Marked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                            <ShieldCheck size={12} className="text-emerald-500" />
                            No Strike
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-bold text-indigo-700 whitespace-nowrap">
                        {formatCurrency(Number(r.requested_refund_amount || 0))}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {renderRefundBadge(r.refund_status)}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {renderCancelBadge(r.cancellation_status)}
                      </td>

                      <td className="py-3.5 px-4 text-slate-500 text-[11px] whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>

                      <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                        {r.reviewer?.name ? (
                          <div>
                            <span className="font-semibold text-slate-800">{r.reviewer.name}</span>
                            {r.reviewed_at && (
                              <p className="text-[10px] text-slate-400">
                                {new Date(r.reviewed_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Pending</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 max-w-[160px] truncate text-slate-500" title={r.review_remarks || 'None'}>
                        {r.review_remarks || '-'}
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          
                          <button
                            onClick={() => setActiveDetailsRequest(r)}
                            className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="View full details"
                          >
                            <Eye size={15} />
                          </button>

                          <button
                            onClick={() => setAuditHistoryRequestId(r.id)}
                            className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="View audit trail"
                          >
                            <History size={15} />
                          </button>

                          <button
                            onClick={() => handleOpenReview(r)}
                            className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            title="Review and add internal remarks"
                          >
                            Review
                          </button>

                          {isSuperAdmin && (
                            <>
                              {['REQUESTED', 'UNDER_REVIEW'].includes(r.refund_status) && (
                                <button
                                  onClick={() => handleOpenApprove(r)}
                                  className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                                  title="Authorize approved refund"
                                >
                                  Approve
                                </button>
                              )}

                              {['REQUESTED', 'UNDER_REVIEW', 'APPROVED'].includes(r.refund_status) && (
                                <button
                                  onClick={() => handleOpenReject(r)}
                                  className="px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                                  title="Reject request"
                                >
                                  Reject
                                </button>
                              )}

                              {r.refund_status === 'APPROVED' && (
                                <button
                                  onClick={() => handleOpenProcessing(r)}
                                  className="px-2.5 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                  title="Record payment transaction & mark processing"
                                >
                                  Process
                                </button>
                              )}

                              {r.refund_status === 'PROCESSING' && (
                                <button
                                  onClick={() => handleOpenComplete(r)}
                                  className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                                  title="Confirm verified settlement"
                                >
                                  Complete
                                </button>
                              )}
                            </>
                          )}

                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination Footer ─────────────────────────────────────────── */}
        <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-500 font-medium">
          <div>
            Showing {filteredRequests.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
            {Math.min(currentPage * pageSize, filteredRequests.length)} of {filteredRequests.length} requests
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-bold text-slate-700 px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 transition-colors"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

      </div>

      {/* =========================================================================
          MODALS
         ========================================================================= */}

      {/* 1. VIEW DETAILS MODAL */}
      {activeDetailsRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-slate-100 overflow-hidden my-8 max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div>
                <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
                  #CR-{activeDetailsRequest.id.slice(0, 8).toUpperCase()}
                </span>
                <h3 className="text-lg font-black text-slate-900 mt-1">Cancellation & Refund Request Dossier</h3>
              </div>
              <button onClick={() => setActiveDetailsRequest(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto text-xs">
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Cancellation</p>
                  <div className="mt-1">{renderCancelBadge(activeDetailsRequest.cancellation_status)}</div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Refund</p>
                  <div className="mt-1">{renderRefundBadge(activeDetailsRequest.refund_status)}</div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Requested Amount</p>
                  <p className="text-sm font-black text-indigo-700 mt-1">{formatCurrency(Number(activeDetailsRequest.requested_refund_amount || 0))}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Approved Amount</p>
                  <p className="text-sm font-black text-emerald-700 mt-1">{formatCurrency(Number(activeDetailsRequest.approved_refund_amount || 0))}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">Student & Campus Profile</h4>
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Name:</span>
                    <span className="font-bold text-slate-800">{activeDetailsRequest.profiles?.name || 'Unknown'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Account ID / ID Number:</span>
                    <span className="font-mono text-slate-800">{activeDetailsRequest.profiles?.id_number || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">University:</span>
                    <span className="font-bold text-slate-800">{activeDetailsRequest.tenants?.name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Strike Snapshot:</span>
                    <span className={`font-bold ${activeDetailsRequest.strike_status_snapshot > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {activeDetailsRequest.strike_status_snapshot} Strike(s) Recorded
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  Associated Order #{activeDetailsRequest.orders?.order_number || 'N/A'}
                </h4>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex justify-between text-slate-500 font-medium pb-2 border-b border-slate-200">
                    <span>Cafeteria: {activeDetailsRequest.orders?.canteens?.name || 'Main Canteen'}</span>
                    <span>Pickup Time: {activeDetailsRequest.orders?.pickup_time}</span>
                  </div>
                  {activeDetailsRequest.orders?.order_items?.map((item: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center text-slate-700">
                      <span>{item.quantity}x {item.menu_items?.name || 'Item'}</span>
                      <span className="font-semibold text-slate-900">
                        ₹{(item.quantity * Number(item.menu_items?.price || 0)).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900">
                    <span>Total Order Value:</span>
                    <span className="text-indigo-600">{formatCurrency(getOrderTotal(activeDetailsRequest))}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">Cancellation Reason</h4>
                <p className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-slate-700 leading-relaxed">
                  {activeDetailsRequest.cancellation_reason}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px]">Reviewed By:</span>
                  <span className="font-semibold text-slate-800">
                    {activeDetailsRequest.reviewer?.name || 'Pending Review'}
                  </span>
                  {activeDetailsRequest.review_remarks && (
                    <p className="text-slate-600 mt-1 italic">"{activeDetailsRequest.review_remarks}"</p>
                  )}
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Payment Reference / Transaction ID:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {activeDetailsRequest.refund_transaction_id || 'Not Processed Yet'}
                  </span>
                  {activeDetailsRequest.processed_at && (
                    <p className="text-slate-400 mt-1">Processed on: {new Date(activeDetailsRequest.processed_at).toLocaleString()}</p>
                  )}
                </div>
              </div>

            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
              <button
                onClick={() => {
                  const reqId = activeDetailsRequest.id;
                  setActiveDetailsRequest(null);
                  setAuditHistoryRequestId(reqId);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
              >
                <History size={14} /> View Audit History
              </button>
              <button
                onClick={() => setActiveDetailsRequest(null)}
                className="px-5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. VIEW BOOKING ORDER MODAL */}
      {activeBookingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-100 overflow-hidden my-8">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <h3 className="font-black text-slate-900 text-base">Booking #{activeBookingOrder.order_number} Details</h3>
              <button onClick={() => setActiveBookingOrder(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <div>
                  <span className="text-slate-400 block text-[10px]">Pickup Slot</span>
                  <span className="font-bold text-slate-800">{activeBookingOrder.pickup_time}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Status</span>
                  <span className="font-bold text-indigo-600">{activeBookingOrder.status}</span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Items in Order</p>
                {activeBookingOrder.order_items?.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-slate-700 py-1 border-b border-slate-100 last:border-0">
                    <span>{item.quantity}x {item.menu_items?.name || 'Item'}</span>
                    <span className="font-semibold text-slate-900">₹{(item.quantity * Number(item.menu_items?.price || 0)).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button onClick={() => setActiveBookingOrder(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. REVIEW REQUEST MODAL */}
      {reviewModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden my-8">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div>
                <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
                  #CR-{reviewModalRequest.id.slice(0, 8).toUpperCase()}
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1">Review & Add Administrative Remarks</h3>
              </div>
              <button onClick={() => setReviewModalRequest(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Student Reason:</span>
                <p className="font-medium text-slate-800 mt-0.5">{reviewModalRequest.cancellation_reason}</p>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">Recommendation</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setReviewRecommendation('RECOMMEND_APPROVE')}
                    className={`py-2 px-3 rounded-xl font-bold border transition-all text-center ${
                      reviewRecommendation === 'RECOMMEND_APPROVE'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Recommend Approval
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewRecommendation('RECOMMEND_REJECT')}
                    className={`py-2 px-3 rounded-xl font-bold border transition-all text-center ${
                      reviewRecommendation === 'RECOMMEND_REJECT'
                        ? 'bg-rose-50 border-rose-300 text-rose-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Recommend Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewRecommendation('NEUTRAL')}
                    className={`py-2 px-3 rounded-xl font-bold border transition-all text-center ${
                      reviewRecommendation === 'NEUTRAL'
                        ? 'bg-amber-50 border-amber-300 text-amber-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Under Review / Neutral
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">Internal Admin Remarks</label>
                <textarea
                  value={reviewRemarks}
                  onChange={(e) => setReviewRemarks(e.target.value)}
                  placeholder="Enter remarks, notes on student situation, verification notes..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-800"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewModalRequest(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitReview}
                disabled={actionLoading}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
              >
                {actionLoading ? 'Saving...' : (isSuperAdmin ? 'Save Review' : 'Submit Review to Super Admin')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. APPROVE REFUND MODAL (Super Admin) */}
      {approveModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden my-8">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div>
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                  Approve Refund
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1">Authorize Approved Refund</h3>
              </div>
              <button onClick={() => setApproveModalRequest(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-amber-900">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>Explicit Approval Step:</strong> Authorizing this refund marks it as approved. It does <strong>not</strong> trigger automatic payment processing. Payment execution is handled in a distinct subsequent step.
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                <div>
                  <span className="text-slate-400 block text-[10px]">Total Order Amount:</span>
                  <span className="font-bold text-slate-800 text-sm">{formatCurrency(getOrderTotal(approveModalRequest))}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 block text-[10px]">Requested Amount:</span>
                  <span className="font-bold text-indigo-600 text-sm">{formatCurrency(Number(approveModalRequest.requested_refund_amount || 0))}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  Approved Refund Amount (₹) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={getOrderTotal(approveModalRequest)}
                  value={approvedAmountInput}
                  onChange={(e) => setApprovedAmountInput(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-400">Cannot exceed paid total: ₹{getOrderTotal(approveModalRequest).toFixed(2)}</span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">Approval Notes</label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Reason for amount or approval justification..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
              <button onClick={() => setApproveModalRequest(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200">
                Cancel
              </button>
              <button
                onClick={handleConfirmApproval}
                disabled={actionLoading}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
              >
                {actionLoading ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. REJECT REFUND MODAL */}
      {rejectModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden my-8">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div>
                <span className="text-xs font-mono font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full">
                  Reject Request
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1">Reject Cancellation / Refund</h3>
              </div>
              <button onClick={() => setRejectModalRequest(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Please enter the reason for rejecting this cancellation and refund request. This explanation will be recorded in the audit history and made visible to the student.
              </p>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  Rejection Explanation <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Explain why the cancellation / refund cannot be granted (e.g. food already prepared, missed collection window without notice)..."
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-rose-500"
                  required
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
              <button onClick={() => setRejectModalRequest(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200">
                Cancel
              </button>
              <button
                onClick={handleConfirmRejection}
                disabled={actionLoading || !rejectionReason.trim()}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MARK REFUND AS PROCESSING MODAL (Super Admin) */}
      {processingModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden my-8">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div>
                <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">
                  Payment Processing
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1">Initiate Refund Payment Execution</h3>
              </div>
              <button onClick={() => setProcessingModalRequest(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-2xl flex justify-between items-center">
                <div>
                  <span className="text-blue-900 block font-bold">Approved Amount to Disburse:</span>
                  <span className="text-xl font-black text-blue-700">₹{Number(processingModalRequest.approved_refund_amount).toFixed(2)}</span>
                </div>
                <span className="text-[10px] text-blue-600 font-semibold bg-white px-2 py-1 rounded-lg border border-blue-100">
                  Approved
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  Payment Gateway / Manual Reference ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={transactionRef}
                  onChange={(e) => setTransactionRef(e.target.value)}
                  placeholder="e.g. RFND_GATEWAY_12345, BURSAR-CHEQUE-789"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800"
                  required
                />
                <span className="text-[10px] text-slate-400">Record gateway payout ID or campus bursar voucher number</span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">Processing Notes</label>
                <textarea
                  value={processingNotes}
                  onChange={(e) => setProcessingNotes(e.target.value)}
                  placeholder="Notes on gateway settlement, batch ID, or finance department confirmation..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
              <button onClick={() => setProcessingModalRequest(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200">
                Cancel
              </button>
              <button
                onClick={handleConfirmProcessing}
                disabled={actionLoading || !transactionRef.trim()}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {actionLoading ? 'Recording...' : 'Mark as Processing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. CONFIRM REFUND COMPLETION MODAL (Super Admin) */}
      {completeModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden my-8">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div>
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                  Verified Completion
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1">Confirm Refund Settlement</h3>
              </div>
              <button onClick={() => setCompleteModalRequest(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-emerald-900">
                <CheckCircle size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>Verification Safeguard:</strong> A refund must never be marked as Completed without explicit verification from the payment gateway webhook or campus finance confirmation.
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount Completed:</span>
                  <span className="font-bold text-slate-800">₹{Number(completeModalRequest.approved_refund_amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Transaction Reference:</span>
                  <span className="font-mono font-bold text-slate-800">{completeModalRequest.refund_transaction_id || 'N/A'}</span>
                </div>
              </div>

              <div 
                onClick={() => setVerifiedCompletion(!verifiedCompletion)}
                className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors select-none"
              >
                <div className="mt-0.5 text-emerald-600">
                  {verifiedCompletion ? <CheckCircle size={16} /> : <div className="w-4 h-4 border border-slate-400 rounded" />}
                </div>
                <span className="text-slate-700 font-medium leading-relaxed">
                  I explicitly verify that the payment gateway has settled the refund or that manual bursar disbursement has been verified.
                </span>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
              <button onClick={() => setCompleteModalRequest(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200">
                Cancel
              </button>
              <button
                onClick={handleConfirmCompletion}
                disabled={actionLoading || !verifiedCompletion}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {actionLoading ? 'Completing...' : 'Mark Refund as Completed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. AUDIT HISTORY MODAL */}
      {auditHistoryRequestId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-slate-100 overflow-hidden my-8 max-h-[85vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div className="flex items-center gap-2">
                <History size={18} className="text-indigo-600" />
                <h3 className="font-black text-slate-900 text-base">Immutable Audit History</h3>
              </div>
              <button onClick={() => setAuditHistoryRequestId(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto text-xs">
              {auditLogsLoading ? (
                <div className="py-8 text-center text-slate-400">Loading audit trail...</div>
              ) : auditLogs.length === 0 ? (
                <div className="py-8 text-center text-slate-400">No audit logs found for this request.</div>
              ) : (
                <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-slate-200">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="relative flex items-start gap-4 pl-8">
                      <div className="absolute left-1.5 top-1.5 w-3.5 h-3.5 rounded-full bg-indigo-600 border-2 border-white shadow-sm" />
                      <div className="flex-1 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-black text-slate-900 uppercase tracking-wider text-[10px]">
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-slate-600 text-[11px] font-medium mb-1.5">
                          Actor: <strong>{log.actor?.name || 'System / User'}</strong>{' '}
                          <span className="text-slate-400 font-normal">({log.actor?.role || 'User'})</span>
                        </div>
                        {log.details && (
                          <pre className="text-[10px] bg-white p-2 rounded-xl border border-slate-200 text-slate-600 font-mono overflow-x-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button onClick={() => setAuditHistoryRequestId(null)} className="px-5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
