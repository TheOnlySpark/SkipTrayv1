import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useDialog } from '../contexts/ModalDialogContext';
import { useAuth } from '../contexts/AuthContext';
import {
  Activity, CheckCircle, XCircle, Clock, AlertCircle, Copy, Lock, Unlock,
  KeyRound, RefreshCw, RefreshCcw, Eye, Search, FileText, ChevronLeft,
  ChevronRight, Download, Play, Building, Check, X, ExternalLink,
  ShieldAlert, ShieldCheck, History, AlertTriangle, Filter,
  CreditCard, ShoppingBag, Database as DbIcon
} from 'lucide-react';

export type WebhookEvent = Database['public']['Tables']['payment_webhook_events']['Row'] & {
  payments: {
    id: string;
    amount: number;
    status: string;
    zohopay_order_id: string | null;
    zohopay_payment_id: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  orders: {
    id: string;
    order_number: number;
    pickup_time: string;
    status: string;
    created_at: string;
    otp_code: string;
    is_takeaway: boolean;
    canteens: { name: string } | null;
    order_items: {
      quantity: number;
      menu_items: { name: string; price: number } | null;
    }[];
  } | null;
  profiles: {
    name: string | null;
    email: string | null;
    id_number: string | null;
  } | null;
  tenants: {
    name: string;
    slug: string;
  } | null;
  payment_locks: {
    id: string;
    resource_type: string;
    resource_id: string;
    lock_owner: string;
    lock_token: string;
    lock_status: Database['public']['Enums']['lock_status'];
    acquired_at: string;
    expires_at: string;
    released_at: string | null;
    release_reason: string | null;
  } | null;
};

export type WebhookAuditLog = Database['public']['Tables']['payment_webhook_audit_logs']['Row'] & {
  actor: {
    name: string | null;
    role: string;
  } | null;
};

interface PaymentWebhookLogsAndLocksProps {
  isSuperAdmin?: boolean;
}

export function PaymentWebhookLogsAndLocks({ isSuperAdmin = false }: PaymentWebhookLogsAndLocksProps) {
  const { showAlert } = useDialog();
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  // Filters & State
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [eventTypeFilter, setEventTypeFilter] = useState('ALL');
  const [gatewayFilter, setGatewayFilter] = useState('ALL');
  const [sigStatusFilter, setSigStatusFilter] = useState('ALL');
  const [procStatusFilter, setProcStatusFilter] = useState('ALL');
  const [lockStatusFilter, setLockStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [quickFilter, setQuickFilter] = useState<'ALL' | 'FAILED' | 'DUPLICATES' | 'ACTIVE_LOCKS' | 'EXPIRED_LOCKS' | 'ATTENTION'>('ALL');
  const [sortBy, setSortBy] = useState<'DATE_DESC' | 'DATE_ASC' | 'AMOUNT_DESC' | 'AMOUNT_ASC' | 'RETRIES_DESC'>('DATE_DESC');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Active Modals & Selection
  const [detailsEvent, setDetailsEvent] = useState<WebhookEvent | null>(null);
  const [relatedPaymentEvent, setRelatedPaymentEvent] = useState<WebhookEvent | null>(null);
  const [relatedBookingEvent, setRelatedBookingEvent] = useState<WebhookEvent | null>(null);
  const [historyEvent, setHistoryEvent] = useState<WebhookEvent | null>(null);
  const [errorDetailsEvent, setErrorDetailsEvent] = useState<WebhookEvent | null>(null);
  const [retryHistoryEvent, setRetryHistoryEvent] = useState<WebhookEvent | null>(null);
  const [lockDetailsEvent, setLockDetailsEvent] = useState<WebhookEvent | null>(null);
  const [retryConfirmEvent, setRetryConfirmEvent] = useState<WebhookEvent | null>(null);
  const [releaseLockEvent, setReleaseLockEvent] = useState<WebhookEvent | null>(null);
  const [reconcileEvent, setReconcileEvent] = useState<WebhookEvent | null>(null);

  // Form Inputs for Modals
  const [releaseReason, setReleaseReason] = useState('Manual administrator expired lock recovery');
  const [reconcileNotes, setReconcileNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  // 2. Fetch Webhook Events
  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['payment_webhook_events', isSuperAdmin, profile?.tenant_id],
    queryFn: async () => {
      let query = supabase
        .from('payment_webhook_events')
        .select(`
          *,
          payments:payment_id (
            id, amount, status, zohopay_order_id, zohopay_payment_id, created_at, updated_at
          ),
          orders:booking_id (
            id, order_number, pickup_time, status, created_at, otp_code, is_takeaway,
            canteens (name),
            order_items (
              quantity,
              menu_items (name, price)
            )
          ),
          profiles:user_id (name, email, id_number),
          tenants:university_id (name, slug),
          payment_locks:lock_id (
            id, resource_type, resource_id, lock_owner, lock_token,
            lock_status, acquired_at, expires_at, released_at, release_reason
          )
        `)
        .order('created_at', { ascending: false });

      if (!isSuperAdmin && profile?.tenant_id) {
        query = query.eq('university_id', profile.tenant_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as WebhookEvent[]) || [];
    }
  });

  // 3. Fetch Audit Logs for active event history modal
  const activeEventForAudit = historyEvent || retryHistoryEvent;
  const { data: auditLogs = [], isLoading: auditLogsLoading } = useQuery({
    queryKey: ['payment_webhook_audit_logs', activeEventForAudit?.id],
    queryFn: async () => {
      if (!activeEventForAudit?.id) return [];
      const { data, error } = await supabase
        .from('payment_webhook_audit_logs')
        .select(`
          *,
          actor:actor_id (name, role)
        `)
        .eq('webhook_event_id', activeEventForAudit.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data as unknown as WebhookAuditLog[]) || [];
    },
    enabled: !!activeEventForAudit?.id
  });

  // Helper formatting functions
  const formatCurrency = (amount: number, currency: string = 'INR') => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2
    }).format(amount || 0);
  };

  const formatDate = (isoString: string | null | undefined) => {
    if (!isoString) return '--';
    const date = new Date(isoString);
    return date.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 4. Real live summary cards calculation
  const now = new Date();
  const summaryMetrics = useMemo(() => {
    const totalEvents = events.length;
    const successfullyProcessed = events.filter(e => e.processing_status === 'PROCESSED').length;
    const pendingProcessing = events.filter(e => ['RECEIVED', 'PROCESSING', 'RETRY_PENDING'].includes(e.processing_status)).length;
    const failedEvents = events.filter(e => e.processing_status === 'FAILED').length;
    const duplicateEvents = events.filter(e => e.processing_status === 'DUPLICATE_EVENT').length;

    const activeLocks = events.filter(e => {
      if (e.lock_status !== 'LOCKED') return false;
      if (!e.lock_expires_at) return true;
      return new Date(e.lock_expires_at) > now;
    }).length;

    const expiredLocks = events.filter(e => {
      if (e.lock_status === 'LOCK_EXPIRED') return true;
      if (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now) return true;
      return false;
    }).length;

    const requiringAttention = events.filter(e => {
      const isFailed = e.processing_status === 'FAILED';
      const isInvalidSig = e.signature_status === 'INVALID_SIGNATURE';
      const isExpiredLock = e.lock_status === 'LOCK_EXPIRED' || (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now);
      const isPendingRetry = e.processing_status === 'RETRY_PENDING';
      return isFailed || isInvalidSig || isExpiredLock || isPendingRetry;
    }).length;

    return {
      totalEvents,
      successfullyProcessed,
      pendingProcessing,
      failedEvents,
      duplicateEvents,
      activeLocks,
      expiredLocks,
      requiringAttention
    };
  }, [events, now]);

  // 5. Filtered & Sorted Events
  const filteredEvents = useMemo(() => {
    let result = events.filter((e) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesEventId = e.id.toLowerCase().includes(term);
        const matchesProviderEventId = e.provider_event_id.toLowerCase().includes(term);
        const matchesPaymentId = e.payment_id?.toLowerCase().includes(term);
        const matchesBookingId = e.booking_id?.toLowerCase().includes(term);
        const matchesUserId = e.user_id?.toLowerCase().includes(term);
        const matchesUserName = e.profiles?.name?.toLowerCase().includes(term);
        const matchesTenantName = e.tenants?.name?.toLowerCase().includes(term);
        const matchesProvider = e.provider.toLowerCase().includes(term);
        if (
          !matchesEventId &&
          !matchesProviderEventId &&
          !matchesPaymentId &&
          !matchesBookingId &&
          !matchesUserId &&
          !matchesUserName &&
          !matchesTenantName &&
          !matchesProvider
        ) {
          return false;
        }
      }

      if (isSuperAdmin && tenantFilter !== 'ALL') {
        if (e.university_id !== tenantFilter) return false;
      }

      if (eventTypeFilter !== 'ALL' && e.event_type !== eventTypeFilter) {
        return false;
      }

      if (gatewayFilter !== 'ALL' && e.provider.toLowerCase() !== gatewayFilter.toLowerCase()) {
        return false;
      }

      if (sigStatusFilter !== 'ALL' && e.signature_status !== sigStatusFilter) {
        return false;
      }

      if (procStatusFilter !== 'ALL' && e.processing_status !== procStatusFilter) {
        return false;
      }

      if (lockStatusFilter !== 'ALL') {
        const isExpired = e.lock_status === 'LOCK_EXPIRED' || (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now);
        if (lockStatusFilter === 'LOCK_EXPIRED' && !isExpired) return false;
        if (lockStatusFilter === 'LOCKED' && (e.lock_status !== 'LOCKED' || isExpired)) return false;
        if (lockStatusFilter === 'UNLOCKED' && e.lock_status !== 'UNLOCKED') return false;
      }

      if (dateFilter !== 'ALL') {
        const eventDate = new Date(e.created_at);
        if (dateFilter === 'TODAY') {
          if (eventDate.toDateString() !== now.toDateString()) return false;
        } else if (dateFilter === 'LAST_7_DAYS') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(now.getDate() - 7);
          if (eventDate < sevenDaysAgo) return false;
        } else if (dateFilter === 'LAST_30_DAYS') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(now.getDate() - 30);
          if (eventDate < thirtyDaysAgo) return false;
        }
      }

      if (quickFilter === 'FAILED' && e.processing_status !== 'FAILED') return false;
      if (quickFilter === 'DUPLICATES' && e.processing_status !== 'DUPLICATE_EVENT') return false;
      if (quickFilter === 'ACTIVE_LOCKS') {
        const isLocked = e.lock_status === 'LOCKED' && (!e.lock_expires_at || new Date(e.lock_expires_at) > now);
        if (!isLocked) return false;
      }
      if (quickFilter === 'EXPIRED_LOCKS') {
        const isExpired = e.lock_status === 'LOCK_EXPIRED' || (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now);
        if (!isExpired) return false;
      }
      if (quickFilter === 'ATTENTION') {
        const isFailed = e.processing_status === 'FAILED';
        const isInvalidSig = e.signature_status === 'INVALID_SIGNATURE';
        const isExpired = e.lock_status === 'LOCK_EXPIRED' || (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now);
        const isRetry = e.processing_status === 'RETRY_PENDING';
        if (!isFailed && !isInvalidSig && !isExpired && !isRetry) return false;
      }

      return true;
    });

    result.sort((a, b) => {
      if (sortBy === 'DATE_DESC') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'DATE_ASC') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === 'AMOUNT_DESC') return Number(b.amount || 0) - Number(a.amount || 0);
      if (sortBy === 'AMOUNT_ASC') return Number(a.amount || 0) - Number(b.amount || 0);
      if (sortBy === 'RETRIES_DESC') return Number(b.retry_count || 0) - Number(a.retry_count || 0);
      return 0;
    });

    return result;
  }, [events, searchTerm, tenantFilter, eventTypeFilter, gatewayFilter, sigStatusFilter, procStatusFilter, lockStatusFilter, dateFilter, quickFilter, sortBy, isSuperAdmin, now]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const paginatedEvents = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredEvents.slice(startIndex, startIndex + pageSize);
  }, [filteredEvents, currentPage, pageSize]);

  const renderSignatureBadge = (status: Database['public']['Enums']['webhook_signature_status']) => {
    switch (status) {
      case 'VERIFIED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <ShieldCheck size={12} /> VERIFIED
          </span>
        );
      case 'INVALID_SIGNATURE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300">
            <ShieldAlert size={12} /> INVALID SIGNATURE
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            SKIPPED
          </span>
        );
    }
  };

  const renderProcessingBadge = (status: Database['public']['Enums']['webhook_processing_status']) => {
    switch (status) {
      case 'PROCESSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle size={12} /> Processed
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200 animate-pulse">
            <RefreshCw size={12} className="animate-spin" /> Processing
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle size={12} /> Failed
          </span>
        );
      case 'RETRY_PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock size={12} /> Retry Pending
          </span>
        );
      case 'DUPLICATE_EVENT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
            <Copy size={12} /> Duplicate Event
          </span>
        );
      case 'RECEIVED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-300">
            <Activity size={12} /> Received
          </span>
        );
    }
  };

  const renderLockBadge = (e: WebhookEvent) => {
    const isExpired = e.lock_status === 'LOCK_EXPIRED' || (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now);

    if (isExpired) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-orange-100 text-orange-800 border border-orange-300">
          <KeyRound size={12} /> Lock Expired
        </span>
      );
    }

    if (e.lock_status === 'LOCKED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
          <Lock size={12} /> Locked
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
        <Unlock size={12} /> Unlocked
      </span>
    );
  };

  // Actions Implementation
  const handleOpenRetryModal = (e: WebhookEvent) => {
    if (e.signature_status === 'INVALID_SIGNATURE') {
      showAlert({
        title: 'Untrusted Event',
        message: 'This event failed cryptographic signature verification. It cannot be retried without security revalidation.',
        type: 'danger'
      });
      return;
    }
    setRetryConfirmEvent(e);
  };

  const handleExecuteRetry = async () => {
    if (!retryConfirmEvent || !profile?.id) return;
    setActionLoading(true);

    try {
      const workerId = `admin-retry-${profile.name || profile.id}`;
      const resourceId = retryConfirmEvent.payment_id || retryConfirmEvent.booking_id || retryConfirmEvent.provider_event_id;

      const { data: lockResult, error: lockErr } = await supabase.rpc('acquire_payment_lock', {
        p_resource_type: 'PAYMENT',
        p_resource_id: resourceId,
        p_tenant_id: retryConfirmEvent.university_id,
        p_lock_owner: workerId,
        p_ttl_seconds: 60
      });

      const resLock = lockResult as any;
      if (lockErr || !resLock?.success) {
        throw new Error(resLock?.message || 'Could not acquire processing lock. Resource is busy.');
      }

      const { lock_id: lockId, lock_token: lockToken } = resLock;

      await supabase
        .from('payment_webhook_events')
        .update({
          processing_status: 'PROCESSING',
          lock_id: lockId,
          lock_status: 'LOCKED',
          lock_owner: workerId,
          lock_acquired_at: new Date().toISOString(),
          retry_count: (retryConfirmEvent.retry_count || 0) + 1,
          last_attempt_at: new Date().toISOString(),
          last_error: null
        })
        .eq('id', retryConfirmEvent.id);

      let resolvedPaymentId = retryConfirmEvent.payment_id;
      if (!resolvedPaymentId) {
        const { data: pm } = await supabase
          .from('payments')
          .select('id')
          .eq('zohopay_order_id', retryConfirmEvent.booking_id)
          .maybeSingle();
        if (pm) resolvedPaymentId = pm.id;
      }

      if (retryConfirmEvent.event_type.includes('captured') || retryConfirmEvent.event_type.includes('success')) {
        if (resolvedPaymentId) {
          await supabase
            .from('payments')
            .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
            .eq('id', resolvedPaymentId);
        }
      }

      const nowIso = new Date().toISOString();
      await supabase
        .from('payment_webhook_events')
        .update({
          payment_id: resolvedPaymentId,
          processing_status: 'PROCESSED',
          lock_status: 'UNLOCKED',
          processed_at: nowIso,
          updated_at: nowIso
        })
        .eq('id', retryConfirmEvent.id);

      await supabase.rpc('release_payment_lock', {
        p_lock_id: lockId,
        p_lock_token: lockToken,
        p_release_reason: 'Administrator manual retry completed successfully'
      });

      await supabase.from('payment_webhook_audit_logs').insert({
        webhook_event_id: retryConfirmEvent.id,
        payment_id: resolvedPaymentId,
        actor_id: profile.id,
        actor_type: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
        tenant_id: retryConfirmEvent.university_id,
        action: 'WEBHOOK_MANUAL_RETRY_SUCCEEDED',
        details: {
          retried_by: profile.name,
          retry_number: (retryConfirmEvent.retry_count || 0) + 1,
          event_type: retryConfirmEvent.event_type,
          processed_at: nowIso
        }
      });

      showAlert({
        title: 'Retry Successful',
        message: 'The webhook event has been safely revalidated and processed.',
        type: 'success'
      });

      setRetryConfirmEvent(null);
      queryClient.invalidateQueries({ queryKey: ['payment_webhook_events'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    } catch (err: any) {
      showAlert({
        title: 'Retry Failed',
        message: err.message || 'Failed to retry event',
        type: 'danger'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenReleaseLockModal = (e: WebhookEvent) => {
    const isExpired = e.lock_status === 'LOCK_EXPIRED' || (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now);
    if (!isExpired) {
      showAlert({
        title: 'Lock Still Active',
        message: `Cannot release an unexpired lock. Active processing leases must finish or expire at ${formatDate(e.lock_expires_at)} to prevent concurrent worker execution.`,
        type: 'warning'
      });
      return;
    }
    setReleaseLockEvent(e);
  };

  const handleExecuteReleaseLock = async () => {
    if (!releaseLockEvent || !profile?.id) return;
    const lockId = releaseLockEvent.lock_id || releaseLockEvent.payment_locks?.id;
    if (!lockId) {
      showAlert({ title: 'Error', message: 'No associated lock record found', type: 'danger' });
      return;
    }

    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('release_expired_lock_admin', {
        p_lock_id: lockId,
        p_admin_id: profile.id,
        p_reason: releaseReason.trim() || 'Manual recovery by administrator'
      });

      const resRelease = data as any;
      if (error || !resRelease?.success) {
        throw new Error(resRelease?.message || error?.message || 'Failed to release lock');
      }

      showAlert({
        title: 'Lock Released',
        message: 'Expired lock lease was safely recovered. Resource is now unlocked.',
        type: 'success'
      });

      setReleaseLockEvent(null);
      queryClient.invalidateQueries({ queryKey: ['payment_webhook_events'] });
      queryClient.invalidateQueries({ queryKey: ['payment_locks'] });
    } catch (err: any) {
      showAlert({
        title: 'Release Failed',
        message: err.message || 'Failed to release expired lock',
        type: 'danger'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExecuteReconciliation = async () => {
    if (!reconcileEvent || !profile?.id) return;
    setActionLoading(true);

    try {
      let resolvedPaymentId = reconcileEvent.payment_id;
      if (!resolvedPaymentId && reconcileEvent.booking_id) {
        const { data: pm } = await supabase
          .from('payments')
          .select('id, status')
          .eq('zohopay_order_id', reconcileEvent.booking_id)
          .maybeSingle();
        if (pm) resolvedPaymentId = pm.id;
      }

      const { data: curPayment } = await supabase
        .from('payments')
        .select('*')
        .eq('id', resolvedPaymentId || '')
        .maybeSingle();

      const authoritativeStatus =
        reconcileEvent.event_type.includes('success') || reconcileEvent.event_type.includes('captured')
          ? 'SUCCESS'
          : reconcileEvent.event_type.includes('failed')
          ? 'FAILED'
          : 'PENDING';

      if (curPayment && curPayment.status !== authoritativeStatus) {
        await supabase
          .from('payments')
          .update({
            status: authoritativeStatus as any,
            updated_at: new Date().toISOString()
          })
          .eq('id', curPayment.id);
      }

      await supabase.from('payment_webhook_audit_logs').insert({
        webhook_event_id: reconcileEvent.id,
        payment_id: resolvedPaymentId,
        actor_id: profile.id,
        actor_type: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
        tenant_id: reconcileEvent.university_id,
        action: 'PAYMENT_STATUS_RECONCILED',
        details: {
          admin_name: profile.name,
          gateway_event: reconcileEvent.provider_event_id,
          previous_status: curPayment?.status || 'UNKNOWN',
          reconciled_status: authoritativeStatus,
          notes: reconcileNotes.trim() || 'Payment status reconciled against verified gateway event'
        }
      });

      showAlert({
        title: 'Reconciliation Completed',
        message: `Payment status verified against authoritative gateway event (${authoritativeStatus}).`,
        type: 'success'
      });

      setReconcileEvent(null);
      queryClient.invalidateQueries({ queryKey: ['payment_webhook_events'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    } catch (err: any) {
      showAlert({
        title: 'Reconciliation Failed',
        message: err.message || 'Failed to reconcile payment status',
        type: 'danger'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExportLogs = (format: 'CSV' | 'JSON') => {
    if (filteredEvents.length === 0) {
      showAlert({ title: 'Export Empty', message: 'No records to export matching current filters.', type: 'warning' });
      return;
    }

    if (format === 'JSON') {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(filteredEvents, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `webhook_logs_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } else {
      const headers = [
        'Event ID', 'Provider Event ID', 'Provider', 'Event Type', 'Payment ID',
        'Booking ID', 'User ID', 'University', 'Amount', 'Currency',
        'Signature Status', 'Processing Status', 'Retry Count', 'Lock Status',
        'Lock Owner', 'Lock Acquired At', 'Lock Expires At', 'Last Error',
        'Received At', 'Processed At'
      ];

      const rows = filteredEvents.map(e => [
        `"${e.id}"`,
        `"${e.provider_event_id}"`,
        `"${e.provider}"`,
        `"${e.event_type}"`,
        `"${e.payment_id || ''}"`,
        `"${e.booking_id || ''}"`,
        `"${e.user_id || ''}"`,
        `"${e.tenants?.name || e.university_id || ''}"`,
        e.amount,
        `"${e.currency}"`,
        `"${e.signature_status}"`,
        `"${e.processing_status}"`,
        e.retry_count,
        `"${e.lock_status}"`,
        `"${e.lock_owner || ''}"`,
        `"${e.lock_acquired_at || ''}"`,
        `"${e.lock_expires_at || ''}"`,
        `"${(e.last_error || '').replace(/"/g, '""')}"`,
        `"${e.created_at}"`,
        `"${e.processed_at || ''}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `webhook_logs_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden mb-8">
      {/* Header Bar */}
      <div className="p-6 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-slate-50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100 shadow-xs">
                <DbIcon size={22} className="stroke-[2.2]" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  Payment Webhook Logs & Distributed Locks
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                    Live Realtime
                  </span>
                </h2>
                <p className="text-xs font-medium text-slate-500 mt-0.5">
                  Authoritative gateway event ingestion, atomic fencing distributed locks, idempotency ledger, and audit logs.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-all shadow-xs"
              title="Refresh webhook logs"
            >
              <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <div className="relative group">
              <button
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-all shadow-xs"
              >
                <Download size={14} />
                Export
              </button>
              <div className="absolute right-0 mt-1 w-32 bg-white rounded-xl shadow-lg border border-slate-200 py-1 hidden group-hover:block z-30">
                <button
                  onClick={() => handleExportLogs('CSV')}
                  className="w-full text-left px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Export as CSV
                </button>
                <button
                  onClick={() => handleExportLogs('JSON')}
                  className="w-full text-left px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Export as JSON
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Summary Cards (8 Live Cards) */}
      <div className="p-6 bg-slate-50/50 border-b border-slate-200/80">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Events</span>
              <Activity size={14} className="text-slate-400" />
            </div>
            <div className="text-xl font-black text-slate-900">{summaryMetrics.totalEvents}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Authoritative inbound</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-emerald-200 shadow-xs bg-gradient-to-b from-white to-emerald-50/20">
            <div className="flex items-center justify-between text-emerald-700 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Processed</span>
              <CheckCircle size={14} className="text-emerald-500" />
            </div>
            <div className="text-xl font-black text-emerald-700">{summaryMetrics.successfullyProcessed}</div>
            <div className="text-[10px] text-emerald-600 font-medium mt-0.5">Committed state</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-blue-200 shadow-xs bg-gradient-to-b from-white to-blue-50/20">
            <div className="flex items-center justify-between text-blue-700 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Pending</span>
              <Clock size={14} className="text-blue-500" />
            </div>
            <div className="text-xl font-black text-blue-700">{summaryMetrics.pendingProcessing}</div>
            <div className="text-[10px] text-blue-600 font-medium mt-0.5">In flight / queue</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-rose-200 shadow-xs bg-gradient-to-b from-white to-rose-50/20">
            <div className="flex items-center justify-between text-rose-700 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Failed</span>
              <XCircle size={14} className="text-rose-500" />
            </div>
            <div className="text-xl font-black text-rose-700">{summaryMetrics.failedEvents}</div>
            <div className="text-[10px] text-rose-600 font-medium mt-0.5">Requires retry</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-purple-200 shadow-xs bg-gradient-to-b from-white to-purple-50/20">
            <div className="flex items-center justify-between text-purple-700 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Duplicates</span>
              <Copy size={14} className="text-purple-500" />
            </div>
            <div className="text-xl font-black text-purple-700">{summaryMetrics.duplicateEvents}</div>
            <div className="text-[10px] text-purple-600 font-medium mt-0.5">Idempotent ignores</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-amber-200 shadow-xs bg-gradient-to-b from-white to-amber-50/20">
            <div className="flex items-center justify-between text-amber-800 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Active Locks</span>
              <Lock size={14} className="text-amber-600" />
            </div>
            <div className="text-xl font-black text-amber-800">{summaryMetrics.activeLocks}</div>
            <div className="text-[10px] text-amber-700 font-medium mt-0.5">Exclusive leases</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-orange-200 shadow-xs bg-gradient-to-b from-white to-orange-50/20">
            <div className="flex items-center justify-between text-orange-800 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Expired Locks</span>
              <KeyRound size={14} className="text-orange-600" />
            </div>
            <div className="text-xl font-black text-orange-800">{summaryMetrics.expiredLocks}</div>
            <div className="text-[10px] text-orange-700 font-medium mt-0.5">Lease timed out</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-red-300 shadow-xs bg-gradient-to-b from-white to-red-50/30 ring-1 ring-red-200/50">
            <div className="flex items-center justify-between text-red-700 mb-1">
              <span className="text-[11px] font-black uppercase tracking-wider">Needs Attention</span>
              <AlertTriangle size={14} className="text-red-500" />
            </div>
            <div className="text-xl font-black text-red-700">{summaryMetrics.requiringAttention}</div>
            <div className="text-[10px] text-red-600 font-bold mt-0.5">Action eligible</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="p-6 border-b border-slate-200/80 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1 mr-1">
            <Filter size={13} /> Quick Views:
          </span>
          <button
            onClick={() => setQuickFilter('ALL')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
              quickFilter === 'ALL'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Logs ({events.length})
          </button>
          <button
            onClick={() => setQuickFilter('FAILED')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
              quickFilter === 'FAILED'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
            }`}
          >
            Failed Only ({summaryMetrics.failedEvents})
          </button>
          <button
            onClick={() => setQuickFilter('DUPLICATES')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
              quickFilter === 'DUPLICATES'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'
            }`}
          >
            Duplicates Only ({summaryMetrics.duplicateEvents})
          </button>
          <button
            onClick={() => setQuickFilter('ACTIVE_LOCKS')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
              quickFilter === 'ACTIVE_LOCKS'
                ? 'bg-amber-700 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
            }`}
          >
            Active Locks ({summaryMetrics.activeLocks})
          </button>
          <button
            onClick={() => setQuickFilter('EXPIRED_LOCKS')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
              quickFilter === 'EXPIRED_LOCKS'
                ? 'bg-orange-700 text-white shadow-xs'
                : 'bg-orange-50 text-orange-800 border border-orange-200 hover:bg-orange-100'
            }`}
          >
            Expired Locks ({summaryMetrics.expiredLocks})
          </button>
          <button
            onClick={() => setQuickFilter('ATTENTION')}
            className={`px-3 py-1 rounded-full text-xs font-black transition-all ${
              quickFilter === 'ATTENTION'
                ? 'bg-red-700 text-white shadow-xs'
                : 'bg-red-50 text-red-800 border border-red-300 hover:bg-red-100'
            }`}
          >
            ⚠️ Requiring Attention ({summaryMetrics.requiringAttention})
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="relative sm:col-span-2">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search Event, Payment, Order, User ID..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-8 py-2 rounded-xl text-xs font-medium border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {isSuperAdmin && (
            <div>
              <select
                value={tenantFilter}
                onChange={(e) => {
                  setTenantFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="ALL">All Universities</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <select
              value={gatewayFilter}
              onChange={(e) => {
                setGatewayFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="ALL">All Gateways</option>
              <option value="ZohoPay">ZohoPay</option>
              <option value="Cashfree">Cashfree</option>
              <option value="Razorpay">Razorpay</option>
            </select>
          </div>

          <div>
            <select
              value={eventTypeFilter}
              onChange={(e) => {
                setEventTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="ALL">All Event Types</option>
              <option value="payment.captured">payment.captured</option>
              <option value="payment.success">payment.success</option>
              <option value="payment.failed">payment.failed</option>
              <option value="refund.processed">refund.processed</option>
            </select>
          </div>

          <div>
            <select
              value={sigStatusFilter}
              onChange={(e) => {
                setSigStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="ALL">All Signatures</option>
              <option value="VERIFIED">Verified</option>
              <option value="INVALID_SIGNATURE">Invalid Signature</option>
              <option value="SKIPPED">Skipped</option>
            </select>
          </div>

          <div>
            <select
              value={procStatusFilter}
              onChange={(e) => {
                setProcStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="ALL">All Statuses</option>
              <option value="PROCESSED">Processed</option>
              <option value="PROCESSING">Processing</option>
              <option value="RECEIVED">Received</option>
              <option value="FAILED">Failed</option>
              <option value="RETRY_PENDING">Retry Pending</option>
              <option value="DUPLICATE_EVENT">Duplicate</option>
            </select>
          </div>

          <div>
            <select
              value={lockStatusFilter}
              onChange={(e) => {
                setLockStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="ALL">All Locks</option>
              <option value="LOCKED">Active Locked</option>
              <option value="LOCK_EXPIRED">Expired Locks</option>
              <option value="UNLOCKED">Unlocked</option>
            </select>
          </div>

          <div>
            <select
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="ALL">All Time</option>
              <option value="TODAY">Today</option>
              <option value="LAST_7_DAYS">Last 7 Days</option>
              <option value="LAST_30_DAYS">Last 30 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. Responsive Table (21 Columns) */}
      <div className="overflow-x-auto min-h-[350px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
            <RefreshCw size={28} className="animate-spin text-indigo-500" />
            <p className="text-xs font-medium">Loading authoritative webhook events & distributed locks...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
            <Activity size={32} className="text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No Webhook Events Found</p>
            <p className="text-xs text-slate-500 max-w-sm text-center">
              No webhook deliveries matched your current filters or search terms.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                <th className="py-3.5 px-4 sticky left-0 bg-slate-50 z-10 shadow-xs"># Event ID</th>
                <th className="py-3.5 px-3">Payment / Coll. ID</th>
                <th className="py-3.5 px-3">Booking / Order ID</th>
                <th className="py-3.5 px-3">User ID</th>
                <th className="py-3.5 px-3">University</th>
                <th className="py-3.5 px-3">Gateway</th>
                <th className="py-3.5 px-3">Event Type</th>
                <th className="py-3.5 px-3 text-right">Amount</th>
                <th className="py-3.5 px-2">Curr.</th>
                <th className="py-3.5 px-3">Received At</th>
                <th className="py-3.5 px-3">Signature Status</th>
                <th className="py-3.5 px-3">Processing Status</th>
                <th className="py-3.5 px-2 text-center">Retries</th>
                <th className="py-3.5 px-3">Lock Status</th>
                <th className="py-3.5 px-3">Lock Owner / Worker</th>
                <th className="py-3.5 px-3">Lock Acquired</th>
                <th className="py-3.5 px-3">Lock Expires</th>
                <th className="py-3.5 px-3">Last Error</th>
                <th className="py-3.5 px-3">Last Attempt</th>
                <th className="py-3.5 px-3">Processed At</th>
                <th className="py-3.5 px-4 sticky right-0 bg-slate-50 z-10 shadow-xs text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedEvents.map((e) => {
                return (
                  <tr key={e.id} className="hover:bg-indigo-50/30 transition-colors group">
                    <td className="py-3 px-4 font-mono font-medium text-slate-900 sticky left-0 bg-white group-hover:bg-indigo-50/30 z-10">
                      <div className="flex items-center gap-1.5">
                        <span title={e.provider_event_id}>
                          {e.provider_event_id.length > 14
                            ? e.provider_event_id.substring(0, 14) + '...'
                            : e.provider_event_id}
                        </span>
                        <button
                          onClick={() => copyToClipboard(e.provider_event_id, e.id)}
                          className="text-slate-400 hover:text-indigo-600 transition-colors"
                          title="Copy Gateway Event ID"
                        >
                          {copiedId === e.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono">
                      {e.payment_id ? (
                        <button
                          onClick={() => setRelatedPaymentEvent(e)}
                          className="text-indigo-600 hover:underline font-semibold flex items-center gap-1"
                          title="View Payment Details"
                        >
                          {e.payment_id.substring(0, 8)}...
                          <ExternalLink size={10} />
                        </button>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>

                    <td className="py-3 px-3 font-mono">
                      {e.booking_id ? (
                        <button
                          onClick={() => setRelatedBookingEvent(e)}
                          className="text-emerald-700 hover:underline font-semibold flex items-center gap-1"
                          title="View Order Details"
                        >
                          {e.orders?.order_number ? `#${e.orders.order_number}` : e.booking_id.substring(0, 8) + '...'}
                          <ExternalLink size={10} />
                        </button>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>

                    <td className="py-3 px-3">
                      {e.profiles?.name ? (
                        <div className="truncate max-w-[120px]" title={e.profiles.name}>
                          <span className="font-semibold text-slate-800">{e.profiles.name}</span>
                          {e.profiles.id_number && (
                            <span className="block text-[10px] text-slate-400 font-mono">{e.profiles.id_number}</span>
                          )}
                        </div>
                      ) : e.user_id ? (
                        <span className="font-mono text-slate-500">{e.user_id.substring(0, 8)}...</span>
                      ) : (
                        <span className="text-slate-400 italic">Anonymous</span>
                      )}
                    </td>

                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                        <Building size={10} />
                        {e.tenants?.name || 'Main Campus'}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-800">
                        <CreditCard size={11} className="text-slate-500" />
                        {e.provider}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <span className="font-mono text-[11px] font-medium text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                        {e.event_type}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-right font-black text-slate-900">
                      {formatCurrency(e.amount, e.currency)}
                    </td>

                    <td className="py-3 px-2 font-mono text-[11px] text-slate-500">
                      {e.currency}
                    </td>

                    <td className="py-3 px-3 text-slate-600">
                      {formatDate(e.created_at)}
                    </td>

                    <td className="py-3 px-3">
                      {renderSignatureBadge(e.signature_status)}
                    </td>

                    <td className="py-3 px-3">
                      {renderProcessingBadge(e.processing_status)}
                    </td>

                    <td className="py-3 px-2 text-center font-mono font-bold text-slate-700">
                      {e.retry_count > 0 ? (
                        <button
                          onClick={() => setRetryHistoryEvent(e)}
                          className="hover:underline text-indigo-600"
                          title="View Retry History"
                        >
                          {e.retry_count}
                        </button>
                      ) : (
                        '0'
                      )}
                    </td>

                    <td className="py-3 px-3">
                      {renderLockBadge(e)}
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                      {e.lock_owner ? (
                        <span title={e.lock_owner}>
                          {e.lock_owner.length > 15 ? e.lock_owner.substring(0, 15) + '...' : e.lock_owner}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-slate-500 text-[11px]">
                      {formatDate(e.lock_acquired_at)}
                    </td>

                    <td className="py-3 px-3 text-slate-500 text-[11px]">
                      {formatDate(e.lock_expires_at)}
                    </td>

                    <td className="py-3 px-3">
                      {e.last_error ? (
                        <button
                          onClick={() => setErrorDetailsEvent(e)}
                          className="text-rose-600 hover:underline max-w-[140px] truncate block font-medium"
                          title={e.last_error}
                        >
                          {e.last_error}
                        </button>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-slate-500 text-[11px]">
                      {formatDate(e.last_attempt_at)}
                    </td>

                    <td className="py-3 px-3 text-slate-600 text-[11px] font-medium">
                      {formatDate(e.processed_at)}
                    </td>

                    <td className="py-3 px-4 sticky right-0 bg-white group-hover:bg-indigo-50/30 z-10 shadow-xs text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setDetailsEvent(e)}
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="View Event Details"
                        >
                          <Eye size={14} />
                        </button>

                        <button
                          onClick={() => setHistoryEvent(e)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Processing History & Audit Logs"
                        >
                          <History size={14} />
                        </button>

                        <button
                          onClick={() => setLockDetailsEvent(e)}
                          className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Inspect Lock Details"
                        >
                          <Lock size={14} />
                        </button>

                        {(e.processing_status === 'FAILED' || e.processing_status === 'RETRY_PENDING') && (
                          <button
                            onClick={() => handleOpenRetryModal(e)}
                            className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors font-bold"
                            title="Retry Failed Event"
                          >
                            <Play size={14} />
                          </button>
                        )}

                        {(e.lock_status === 'LOCK_EXPIRED' || (e.lock_status === 'LOCKED' && e.lock_expires_at && new Date(e.lock_expires_at) <= now)) && (
                          <button
                            onClick={() => handleOpenReleaseLockModal(e)}
                            className="p-1.5 text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors font-bold"
                            title="Release Expired Lock"
                          >
                            <Unlock size={14} />
                          </button>
                        )}

                        <button
                          onClick={() => setReconcileEvent(e)}
                          className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Reconcile Payment Status"
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Bar */}
      <div className="p-4 border-t border-slate-200/80 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-3">
          <span>
            Showing <strong className="text-slate-900">{Math.min(filteredEvents.length, (currentPage - 1) * pageSize + 1)}</strong> to{' '}
            <strong className="text-slate-900">{Math.min(filteredEvents.length, currentPage * pageSize)}</strong> of{' '}
            <strong className="text-slate-900">{filteredEvents.length}</strong> events
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="py-1 px-2 border border-slate-200 bg-white rounded-lg text-xs font-semibold focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-3 py-1 font-bold text-slate-800">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* MODAL 1: View Event Details */}
      {detailsEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <FileText className="text-indigo-600" size={18} />
                <h3 className="font-bold text-slate-900 text-sm">Authoritative Gateway Webhook Event</h3>
              </div>
              <button
                onClick={() => setDetailsEvent(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Event ID</span>
                  <span className="font-mono font-bold text-slate-800">{detailsEvent.id}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Provider Event Reference</span>
                  <span className="font-mono font-bold text-slate-800">{detailsEvent.provider_event_id}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Payment Gateway</span>
                  <span className="font-bold text-slate-800">{detailsEvent.provider}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Event Type</span>
                  <span className="font-mono font-bold text-indigo-700">{detailsEvent.event_type}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Amount & Currency</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatCurrency(detailsEvent.amount, detailsEvent.currency)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Signature Status</span>
                  {renderSignatureBadge(detailsEvent.signature_status)}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold uppercase text-slate-500">Raw Webhook Payload JSON</span>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(detailsEvent.payload, null, 2), 'payload-json')}
                    className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold text-[11px]"
                  >
                    <Copy size={12} /> Copy Payload
                  </button>
                </div>
                <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60 border border-slate-800">
                  {JSON.stringify(detailsEvent.payload, null, 2)}
                </pre>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button
                onClick={() => setDetailsEvent(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-900 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: View Related Payment */}
      {relatedPaymentEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <CreditCard className="text-indigo-600" size={18} />
                <h3 className="font-bold text-slate-900 text-sm">Related Payment Collection Record</h3>
              </div>
              <button onClick={() => setRelatedPaymentEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs">
              {relatedPaymentEvent.payments ? (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Payment ID:</span>
                      <span className="font-mono font-bold">{relatedPaymentEvent.payments.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Collection Status:</span>
                      <span className={`font-black px-2 py-0.5 rounded text-[10px] ${
                        relatedPaymentEvent.payments.status === 'SUCCESS'
                          ? 'bg-emerald-100 text-emerald-800'
                          : relatedPaymentEvent.payments.status === 'FAILED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {relatedPaymentEvent.payments.status}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Collected Amount:</span>
                      <span className="font-black text-slate-900">
                        {formatCurrency(relatedPaymentEvent.payments.amount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Gateway Order Ref:</span>
                      <span className="font-mono">{relatedPaymentEvent.payments.zohopay_order_id || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Gateway Payment Ref:</span>
                      <span className="font-mono">{relatedPaymentEvent.payments.zohopay_payment_id || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Created At:</span>
                      <span>{formatDate(relatedPaymentEvent.payments.created_at)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 italic text-center py-4">No matching payment row found in payments table.</p>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setRelatedPaymentEvent(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: View Related Booking */}
      {relatedBookingEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <ShoppingBag className="text-emerald-600" size={18} />
                <h3 className="font-bold text-slate-900 text-sm">Related Booking Order Details</h3>
              </div>
              <button onClick={() => setRelatedBookingEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs">
              {relatedBookingEvent.orders ? (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Order Number:</span>
                      <span className="font-black text-indigo-700 text-sm">#{relatedBookingEvent.orders.order_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Cafeteria / Canteen:</span>
                      <span className="font-bold text-slate-800">{relatedBookingEvent.orders.canteens?.name || 'Main Canteen'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Pickup Slot:</span>
                      <span className="font-bold text-slate-800">{relatedBookingEvent.orders.pickup_time}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Pickup OTP:</span>
                      <span className="font-mono font-black text-emerald-700">{relatedBookingEvent.orders.otp_code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Order Status:</span>
                      <span className="font-bold text-slate-800">{relatedBookingEvent.orders.status}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-slate-600 mb-1.5 block uppercase">Items in Order</span>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                      {relatedBookingEvent.orders.order_items?.map((item, idx) => (
                        <div key={idx} className="p-2.5 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-slate-800">{item.menu_items?.name || 'Item'}</span>
                            <span className="text-slate-400 text-[10px] ml-2">x{item.quantity}</span>
                          </div>
                          <span className="font-bold text-slate-900">
                            {formatCurrency((item.menu_items?.price || 0) * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 italic text-center py-4">No matching booking row found in orders table.</p>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setRelatedBookingEvent(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Processing History & Audit Logs */}
      {historyEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <History className="text-indigo-600" size={18} />
                <h3 className="font-bold text-slate-900 text-sm">Processing Lifecycle & Audit Trail</h3>
              </div>
              <button onClick={() => setHistoryEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="border-l-2 border-indigo-200 pl-4 space-y-4">
                <div className="relative">
                  <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-slate-400"></div>
                  <span className="font-bold text-slate-800 block">1. Ingestion Received</span>
                  <span className="text-[10px] text-slate-500">{formatDate(historyEvent.created_at)}</span>
                  <p className="text-slate-600 text-[11px] mt-0.5">Gateway payload accepted with signature verification.</p>
                </div>

                {historyEvent.lock_acquired_at && (
                  <div className="relative">
                    <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                    <span className="font-bold text-slate-800 block">2. Distributed Lock Acquired</span>
                    <span className="text-[10px] text-slate-500">{formatDate(historyEvent.lock_acquired_at)}</span>
                    <p className="text-slate-600 text-[11px] mt-0.5">
                      Worker lease locked by <code className="font-mono text-amber-700">{historyEvent.lock_owner}</code>.
                    </p>
                  </div>
                )}

                {historyEvent.processed_at && (
                  <div className="relative">
                    <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                    <span className="font-bold text-emerald-800 block">3. State Committed & Lock Released</span>
                    <span className="text-[10px] text-slate-500">{formatDate(historyEvent.processed_at)}</span>
                    <p className="text-slate-600 text-[11px] mt-0.5">Database payment update committed atomically.</p>
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-bold text-slate-700 text-xs mb-2 uppercase tracking-wide">Immutable Audit Entries</h4>
                {auditLogsLoading ? (
                  <p className="text-slate-400 italic">Loading audit trail...</p>
                ) : auditLogs.length === 0 ? (
                  <p className="text-slate-400 italic">No explicit audit entries recorded for this event.</p>
                ) : (
                  <div className="space-y-2">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-indigo-700 text-[11px]">{log.action}</span>
                          <span className="text-[10px] text-slate-400">{formatDate(log.created_at)}</span>
                        </div>
                        <div className="text-[10px] text-slate-600">
                          Actor: <strong>{log.actor?.name || log.actor_type}</strong>
                        </div>
                        {log.details && (
                          <pre className="mt-1 text-[10px] bg-slate-200/60 p-1.5 rounded font-mono overflow-x-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setHistoryEvent(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: View Error Details */}
      {errorDetailsEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-rose-100 flex items-center justify-between bg-rose-50/50">
              <div className="flex items-center gap-2">
                <AlertCircle className="text-rose-600" size={18} />
                <h3 className="font-bold text-rose-900 text-sm">Webhook Execution Error Details</h3>
              </div>
              <button onClick={() => setErrorDetailsEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="p-3.5 bg-rose-50 rounded-xl border border-rose-200 text-rose-900 font-mono text-[11px] whitespace-pre-wrap">
                {errorDetailsEvent.last_error}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 block font-bold">Last Attempt Timestamp:</span>
                  <span className="font-medium text-slate-700">{formatDate(errorDetailsEvent.last_attempt_at)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-bold">Failed Retry Count:</span>
                  <span className="font-medium text-slate-700">{errorDetailsEvent.retry_count} attempts</span>
                </div>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px]">
                <strong>Troubleshooting Advice:</strong> If the error indicates a signature mismatch, check payment gateway webhook secrets. If an amount mismatch occurred, investigate order price calculations.
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setErrorDetailsEvent(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: View Retry History */}
      {retryHistoryEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <RefreshCw className="text-indigo-600" size={18} />
                <h3 className="font-bold text-slate-900 text-sm">Retry History</h3>
              </div>
              <button onClick={() => setRetryHistoryEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl flex justify-between border border-slate-200">
                <span className="font-bold text-slate-700">Total Retry Attempts:</span>
                <span className="font-black text-indigo-700">{retryHistoryEvent.retry_count}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl flex justify-between border border-slate-200">
                <span className="font-bold text-slate-700">Last Attempt:</span>
                <span className="font-mono text-slate-800">{formatDate(retryHistoryEvent.last_attempt_at)}</span>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setRetryHistoryEvent(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 7: Inspect Lock Details */}
      {lockDetailsEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-amber-100 flex items-center justify-between bg-amber-50/50">
              <div className="flex items-center gap-2">
                <Lock className="text-amber-600" size={18} />
                <h3 className="font-bold text-amber-900 text-sm">Distributed Fencing Lock Inspection</h3>
              </div>
              <button onClick={() => setLockDetailsEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Lock Status:</span>
                  {renderLockBadge(lockDetailsEvent)}
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Lock Owner / Worker ID:</span>
                  <span className="font-mono font-bold text-slate-800">{lockDetailsEvent.lock_owner || 'None'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Lock Acquired At:</span>
                  <span className="text-slate-800">{formatDate(lockDetailsEvent.lock_acquired_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Lock Expires At:</span>
                  <span className="text-slate-800">{formatDate(lockDetailsEvent.lock_expires_at)}</span>
                </div>
                {lockDetailsEvent.payment_locks?.lock_token && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold uppercase text-[10px]">Fencing Token:</span>
                    <span className="font-mono text-[10px] text-slate-700">{lockDetailsEvent.payment_locks.lock_token}</span>
                  </div>
                )}
                {lockDetailsEvent.payment_locks?.released_at && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold uppercase text-[10px]">Released At:</span>
                    <span className="text-slate-800">{formatDate(lockDetailsEvent.payment_locks.released_at)}</span>
                  </div>
                )}
                {lockDetailsEvent.payment_locks?.release_reason && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold uppercase text-[10px]">Release Reason:</span>
                    <span className="text-slate-800">{lockDetailsEvent.payment_locks.release_reason}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setLockDetailsEvent(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 8: Retry Confirmation Modal */}
      {retryConfirmEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-rose-100 flex items-center justify-between bg-rose-50/50">
              <div className="flex items-center gap-2">
                <Play className="text-rose-600" size={18} />
                <h3 className="font-bold text-rose-900 text-sm">Confirm Webhook Safe Reprocessing</h3>
              </div>
              <button onClick={() => setRetryConfirmEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-700">
                Are you sure you want to request a retry for failed event{' '}
                <strong className="font-mono">{retryConfirmEvent.provider_event_id}</strong>?
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] space-y-1">
                <strong>Idempotency Guarantee:</strong> Retrying revalidates the existing gateway event and applies atomic database updates. It will <strong>NOT</strong> initiate a new payment collection or double-charge the customer.
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setRetryConfirmEvent(null)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteRetry}
                disabled={actionLoading}
                className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 transition-colors flex items-center gap-1.5"
              >
                {actionLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                Execute Safe Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 9: Release Expired Lock Modal */}
      {releaseLockEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-orange-100 flex items-center justify-between bg-orange-50/50">
              <div className="flex items-center gap-2">
                <Unlock className="text-orange-600" size={18} />
                <h3 className="font-bold text-orange-900 text-sm">Release Expired Lock Lease</h3>
              </div>
              <button onClick={() => setReleaseLockEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-700">
                The processing lease for worker <strong className="font-mono">{releaseLockEvent.lock_owner}</strong> has expired. Releasing will allow subsequent workers or administrators to safely process this resource.
              </p>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Audit Reason for Lock Recovery:</label>
                <input
                  type="text"
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-orange-500/30"
                  placeholder="e.g. Worker crashed, manual lease recovery"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setReleaseLockEvent(null)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteReleaseLock}
                disabled={actionLoading}
                className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold hover:bg-orange-700 transition-colors flex items-center gap-1.5"
              >
                {actionLoading ? <RefreshCw size={14} className="animate-spin" /> : <Unlock size={14} />}
                Release Expired Lock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 10: Reconcile Payment Status Modal */}
      {reconcileEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-emerald-100 flex items-center justify-between bg-emerald-50/50">
              <div className="flex items-center gap-2">
                <RefreshCw className="text-emerald-600" size={18} />
                <h3 className="font-bold text-emerald-900 text-sm">Reconcile Payment Collection Status</h3>
              </div>
              <button onClick={() => setReconcileEvent(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-700">
                Compare and synchronize SkipTray database status with authoritative gateway webhook state.
              </p>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Gateway Event Type:</span>
                  <span className="font-mono font-bold text-indigo-700">{reconcileEvent.event_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Payment Record:</span>
                  <span className="font-bold text-slate-800">{reconcileEvent.payments?.status || 'NOT_FOUND'}</span>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Reconciliation Audit Remarks:</label>
                <textarea
                  rows={2}
                  value={reconcileNotes}
                  onChange={(e) => setReconcileNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="Optional audit notes on discrepancy resolution"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setReconcileEvent(null)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteReconciliation}
                disabled={actionLoading}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
              >
                {actionLoading ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Confirm Reconciliation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
