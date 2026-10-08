import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';
import { useDialog } from '../contexts/ModalDialogContext';
import { useAuth } from '../contexts/AuthContext';
import {
  CreditCard, CheckCircle, XCircle, Clock, AlertCircle, Copy, Check,
  Search, RefreshCw, RefreshCcw, Eye, Download, Building, ShoppingBag,
  ExternalLink, Filter, ChevronLeft, ChevronRight, X
} from 'lucide-react';

export type PaymentRecord = Database['public']['Tables']['payments']['Row'] & {
  profiles: {
    name: string | null;
    email: string | null;
    id_number: string | null;
  } | null;
  tenants: {
    name: string;
    slug: string;
  } | null;
  orders: {
    id: string;
    order_number: number;
    pickup_time: string;
    status: string;
    otp_code: string;
    is_takeaway: boolean;
    canteens: { name: string } | null;
    order_items: {
      quantity: number;
      menu_items: { name: string; price: number } | null;
    }[];
  }[];
};

interface PaymentCollectionManagementProps {
  isSuperAdmin?: boolean;
}

export function PaymentCollectionManagement({ isSuperAdmin = false }: PaymentCollectionManagementProps) {
  const { showAlert } = useDialog();
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  // Filters & State
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SUCCESS' | 'PENDING' | 'FAILED'>('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'DATE_DESC' | 'DATE_ASC' | 'AMOUNT_DESC' | 'AMOUNT_ASC'>('DATE_DESC');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Active Modals
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PaymentRecord['orders'][0] | null>(null);
  const [reconcilePayment, setReconcilePayment] = useState<PaymentRecord | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  // 2. Fetch Payments
  const { data: payments = [], isLoading, refetch } = useQuery({
    queryKey: ['payment_collections', isSuperAdmin, profile?.tenant_id],
    queryFn: async () => {
      let query = supabase
        .from('payments')
        .select(`
          *,
          profiles:user_id (name, email, id_number),
          tenants:tenant_id (name, slug),
          orders:orders!orders_payment_id_fkey (
            id, order_number, pickup_time, status, otp_code, is_takeaway,
            canteens (name),
            order_items (
              quantity,
              menu_items (name, price)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (!isSuperAdmin && profile?.tenant_id) {
        query = query.eq('tenant_id', profile.tenant_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as PaymentRecord[]) || [];
    }
  });

  // Helper Formatters
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
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

  // Summary Metrics from real records
  const now = new Date();
  const summaryMetrics = useMemo(() => {
    const totalCollections = payments.length;
    const totalVolume = payments
      .filter((p) => p.status === 'SUCCESS')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const successCount = payments.filter((p) => p.status === 'SUCCESS').length;
    const pendingCount = payments.filter((p) => p.status === 'PENDING').length;
    const failedCount = payments.filter((p) => p.status === 'FAILED').length;

    return {
      totalCollections,
      totalVolume,
      successCount,
      pendingCount,
      failedCount
    };
  }, [payments]);

  // Filtered & Sorted Payments
  const filteredPayments = useMemo(() => {
    let result = payments.filter((p) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesId = p.id.toLowerCase().includes(term);
        const matchesUser = p.profiles?.name?.toLowerCase().includes(term);
        const matchesEmail = p.profiles?.email?.toLowerCase().includes(term);
        const matchesTenant = p.tenants?.name?.toLowerCase().includes(term);
        const matchesZohoOrder = p.zohopay_order_id?.toLowerCase().includes(term);
        const matchesZohoPayment = p.zohopay_payment_id?.toLowerCase().includes(term);
        const matchesOrderNum = p.orders?.some((o) => o.order_number?.toString().includes(term));
        if (!matchesId && !matchesUser && !matchesEmail && !matchesTenant && !matchesZohoOrder && !matchesZohoPayment && !matchesOrderNum) {
          return false;
        }
      }

      if (isSuperAdmin && tenantFilter !== 'ALL') {
        if (p.tenant_id !== tenantFilter) return false;
      }

      if (statusFilter !== 'ALL' && p.status !== statusFilter) {
        return false;
      }

      if (dateFilter !== 'ALL') {
        const pDate = new Date(p.created_at);
        if (dateFilter === 'TODAY') {
          if (pDate.toDateString() !== now.toDateString()) return false;
        } else if (dateFilter === 'LAST_7_DAYS') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(now.getDate() - 7);
          if (pDate < sevenDaysAgo) return false;
        } else if (dateFilter === 'LAST_30_DAYS') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(now.getDate() - 30);
          if (pDate < thirtyDaysAgo) return false;
        }
      }

      return true;
    });

    result.sort((a, b) => {
      if (sortBy === 'DATE_DESC') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'DATE_ASC') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === 'AMOUNT_DESC') return Number(b.amount || 0) - Number(a.amount || 0);
      if (sortBy === 'AMOUNT_ASC') return Number(a.amount || 0) - Number(b.amount || 0);
      return 0;
    });

    return result;
  }, [payments, searchTerm, tenantFilter, statusFilter, dateFilter, sortBy, isSuperAdmin, now]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / pageSize));
  const paginatedPayments = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredPayments.slice(startIndex, startIndex + pageSize);
  }, [filteredPayments, currentPage, pageSize]);

  const renderStatusBadge = (status: Database['public']['Enums']['payment_status']) => {
    switch (status) {
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle size={12} /> SUCCESS
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock size={12} /> PENDING
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle size={12} /> FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  const handleExportPayments = () => {
    if (filteredPayments.length === 0) {
      showAlert({ title: 'Export Empty', message: 'No records to export matching current filters.', type: 'warning' });
      return;
    }

    const headers = ['Payment ID', 'User Name', 'User Email', 'University', 'Amount', 'Status', 'Gateway Order ID', 'Gateway Payment ID', 'Created At'];
    const rows = filteredPayments.map((p) => [
      `"${p.id}"`,
      `"${p.profiles?.name || ''}"`,
      `"${p.profiles?.email || ''}"`,
      `"${p.tenants?.name || ''}"`,
      p.amount,
      `"${p.status}"`,
      `"${p.zohopay_order_id || ''}"`,
      `"${p.zohopay_payment_id || ''}"`,
      `"${p.created_at}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `payment_collections_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden mb-8">
      {/* Header Bar */}
      <div className="p-6 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-slate-50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 shadow-xs">
                <CreditCard size={22} className="stroke-[2.2]" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  Payment Collection Management
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Settled Records
                  </span>
                </h2>
                <p className="text-xs font-medium text-slate-500 mt-0.5">
                  Platform payment collections, gateway session tracking, customer order mapping, and collection auditing.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-all shadow-xs"
              title="Refresh payments"
            >
              <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={handleExportPayments}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-all shadow-xs"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="p-6 bg-slate-50/50 border-b border-slate-200/80">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Collections</span>
              <CreditCard size={15} className="text-slate-400" />
            </div>
            <div className="text-2xl font-black text-slate-900">{summaryMetrics.totalCollections}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">All initiated sessions</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs bg-gradient-to-b from-white to-emerald-50/20">
            <div className="flex items-center justify-between text-emerald-700 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Collected Volume</span>
              <CheckCircle size={15} className="text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-emerald-700">{formatCurrency(summaryMetrics.totalVolume)}</div>
            <div className="text-[10px] text-emerald-600 font-medium mt-0.5">Settled gateway funds</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs">
            <div className="flex items-center justify-between text-emerald-700 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Successful</span>
              <CheckCircle size={15} className="text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-emerald-700">{summaryMetrics.successCount}</div>
            <div className="text-[10px] text-emerald-600 font-medium mt-0.5">Captured & confirmed</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs">
            <div className="flex items-center justify-between text-amber-800 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Pending</span>
              <Clock size={15} className="text-amber-500" />
            </div>
            <div className="text-2xl font-black text-amber-800">{summaryMetrics.pendingCount}</div>
            <div className="text-[10px] text-amber-700 font-medium mt-0.5">Awaiting gateway event</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-xs">
            <div className="flex items-center justify-between text-rose-700 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Failed</span>
              <XCircle size={15} className="text-rose-500" />
            </div>
            <div className="text-2xl font-black text-rose-700">{summaryMetrics.failedCount}</div>
            <div className="text-[10px] text-rose-600 font-medium mt-0.5">Unsuccessful charges</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="p-6 border-b border-slate-200/80">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="relative sm:col-span-2">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search Payment ID, Order, User, Gateway ID..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-8 py-2 rounded-xl text-xs font-medium border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white"
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
                className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="ALL">All Payment Statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          <div>
            <select
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="ALL">All Time</option>
              <option value="TODAY">Today</option>
              <option value="LAST_7_DAYS">Last 7 Days</option>
              <option value="LAST_30_DAYS">Last 30 Days</option>
            </select>
          </div>

          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full py-2 px-3 rounded-xl text-xs font-medium border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="DATE_DESC">Newest First</option>
              <option value="DATE_ASC">Oldest First</option>
              <option value="AMOUNT_DESC">Highest Amount</option>
              <option value="AMOUNT_ASC">Lowest Amount</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto min-h-[300px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
            <RefreshCw size={28} className="animate-spin text-emerald-500" />
            <p className="text-xs font-medium">Loading collection records...</p>
          </div>
        ) : filteredPayments.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
            <CreditCard size={32} className="text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No Payment Records Found</p>
            <p className="text-xs text-slate-500">No payment collections matched your active search or filters.</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                <th className="py-3.5 px-4 sticky left-0 bg-slate-50 z-10 shadow-xs">Payment ID</th>
                <th className="py-3.5 px-3">Order #</th>
                <th className="py-3.5 px-3">Customer</th>
                <th className="py-3.5 px-3">University</th>
                <th className="py-3.5 px-3">Gateway Order Ref</th>
                <th className="py-3.5 px-3">Gateway Payment Ref</th>
                <th className="py-3.5 px-3 text-right">Amount</th>
                <th className="py-3.5 px-3">Status</th>
                <th className="py-3.5 px-3">Created At</th>
                <th className="py-3.5 px-3">Updated At</th>
                <th className="py-3.5 px-4 sticky right-0 bg-slate-50 z-10 shadow-xs text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedPayments.map((p) => {
                const primaryOrder = p.orders?.[0];
                return (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="py-3 px-4 font-mono font-medium text-slate-900 sticky left-0 bg-white group-hover:bg-slate-50/80 z-10">
                      <div className="flex items-center gap-1.5">
                        <span title={p.id}>{p.id.substring(0, 10)}...</span>
                        <button
                          onClick={() => copyToClipboard(p.id, p.id)}
                          className="text-slate-400 hover:text-emerald-600 transition-colors"
                          title="Copy Payment ID"
                        >
                          {copiedId === p.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      {primaryOrder ? (
                        <button
                          onClick={() => setSelectedOrder(primaryOrder)}
                          className="text-emerald-700 hover:underline font-bold flex items-center gap-1"
                        >
                          #{primaryOrder.order_number}
                          <ExternalLink size={10} />
                        </button>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>

                    <td className="py-3 px-3">
                      <div className="truncate max-w-[130px]">
                        <span className="font-semibold text-slate-800">{p.profiles?.name || 'Customer'}</span>
                        <span className="block text-[10px] text-slate-400 font-mono truncate">{p.profiles?.email || ''}</span>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                        <Building size={10} />
                        {p.tenants?.name || 'Main Campus'}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                      {p.zohopay_order_id ? (
                        <span title={p.zohopay_order_id}>
                          {p.zohopay_order_id.length > 12 ? p.zohopay_order_id.substring(0, 12) + '...' : p.zohopay_order_id}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">N/A</span>
                      )}
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                      {p.zohopay_payment_id ? (
                        <span title={p.zohopay_payment_id}>
                          {p.zohopay_payment_id.length > 12 ? p.zohopay_payment_id.substring(0, 12) + '...' : p.zohopay_payment_id}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">N/A</span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right font-black text-slate-900">
                      {formatCurrency(p.amount)}
                    </td>

                    <td className="py-3 px-3">
                      {renderStatusBadge(p.status)}
                    </td>

                    <td className="py-3 px-3 text-slate-600">
                      {formatDate(p.created_at)}
                    </td>

                    <td className="py-3 px-3 text-slate-600">
                      {formatDate(p.updated_at)}
                    </td>

                    <td className="py-3 px-4 sticky right-0 bg-white group-hover:bg-slate-50/80 z-10 shadow-xs text-center">
                      <button
                        onClick={() => setSelectedPayment(p)}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="View Payment Collection Details"
                      >
                        <Eye size={14} />
                      </button>
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
        <div>
          Showing <strong className="text-slate-900">{Math.min(filteredPayments.length, (currentPage - 1) * pageSize + 1)}</strong> to{' '}
          <strong className="text-slate-900">{Math.min(filteredPayments.length, currentPage * pageSize)}</strong> of{' '}
          <strong className="text-slate-900">{filteredPayments.length}</strong> collections
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

      {/* MODAL: View Payment Details */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <CreditCard className="text-emerald-600" size={18} />
                <h3 className="font-bold text-slate-900 text-sm">Payment Collection Record</h3>
              </div>
              <button onClick={() => setSelectedPayment(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Payment ID:</span>
                  <span className="font-mono font-bold">{selectedPayment.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Customer:</span>
                  <span className="font-bold">{selectedPayment.profiles?.name || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Campus:</span>
                  <span>{selectedPayment.tenants?.name || 'Main Campus'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Amount:</span>
                  <span className="font-black text-slate-900 text-sm">{formatCurrency(selectedPayment.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Status:</span>
                  {renderStatusBadge(selectedPayment.status)}
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Gateway Order Ref:</span>
                  <span className="font-mono">{selectedPayment.zohopay_order_id || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Gateway Payment Ref:</span>
                  <span className="font-mono">{selectedPayment.zohopay_payment_id || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Created At:</span>
                  <span>{formatDate(selectedPayment.created_at)}</span>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedPayment(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: View Order Details */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <ShoppingBag className="text-emerald-600" size={18} />
                <h3 className="font-bold text-slate-900 text-sm">Order #{selectedOrder.order_number}</h3>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Cafeteria:</span>
                  <span className="font-bold">{selectedOrder.canteens?.name || 'Main Canteen'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Pickup Slot:</span>
                  <span className="font-bold">{selectedOrder.pickup_time}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Pickup OTP:</span>
                  <span className="font-mono font-black text-emerald-700">{selectedOrder.otp_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase text-[10px]">Status:</span>
                  <span className="font-bold">{selectedOrder.status}</span>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-bold text-slate-600 mb-1.5 block uppercase">Items</span>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                  {selectedOrder.order_items?.map((item, idx) => (
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
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
