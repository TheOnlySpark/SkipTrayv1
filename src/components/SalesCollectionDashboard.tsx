import React, { useState } from 'react';
import {
  Clock,
  TrendingUp,
  Minus,
  ShoppingBag,
  IndianRupee,
  CalendarDays,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Maximize2,
  Minimize2
} from 'lucide-react';
import {
  SalesCollectionDashboard as ISalesCollectionDashboard,
  CollectionPeriodSummary,
  formatCurrency
} from '../lib/salesAnalytics';

interface SalesCollectionDashboardProps {
  data: ISalesCollectionDashboard;
  isLoading?: boolean;
  activePeriod?: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'ALL';
  onSelectPeriod?: (period: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'ALL') => void;
  defaultCompact?: boolean;
}

export const SalesCollectionDashboard: React.FC<SalesCollectionDashboardProps> = ({
  data,
  isLoading = false,
  activePeriod = 'TODAY',
  onSelectPeriod,
  defaultCompact = true
}) => {
  const [isCompact, setIsCompact] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sales_summary_compact');
      return saved !== null ? saved === 'true' : defaultCompact;
    } catch {
      return defaultCompact;
    }
  });

  const toggleCompact = () => {
    setIsCompact(prev => {
      const next = !prev;
      try {
        localStorage.setItem('sales_summary_compact', String(next));
      } catch {}
      return next;
    });
  };

  const cards: {
    id: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';
    title: string;
    period: CollectionPeriodSummary;
    icon: React.ComponentType<{ className?: string; size?: number }>;
  }[] = [
    {
      id: 'TODAY',
      title: 'Today',
      period: data.today,
      icon: Sparkles,
    },
    {
      id: 'YESTERDAY',
      title: 'Yesterday',
      period: data.yesterday,
      icon: Clock,
    },
    {
      id: 'LAST_7_DAYS',
      title: 'Last 7 Days',
      period: data.last7Days,
      icon: CalendarDays,
    },
    {
      id: 'LAST_30_DAYS',
      title: 'Last 30 Days',
      period: data.last30Days,
      icon: TrendingUp,
    },
  ];

  if (isLoading) {
    return (
      <div className="col-span-12 mb-5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="h-5 w-48 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-7 w-24 bg-slate-100 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(idx => (
            <div
              key={idx}
              className="p-3 sm:p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-xs space-y-2 animate-pulse"
            >
              <div className="flex justify-between items-center">
                <div className="h-3.5 w-16 bg-slate-200 rounded" />
                <div className="h-3 w-12 bg-slate-100 rounded" />
              </div>
              <div className="h-6 w-24 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="col-span-12 mb-5 space-y-2.5">
      {/* Sleek, Single-Row Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
            <span className="p-1 rounded-md bg-emerald-100 text-emerald-800">
              <IndianRupee size={13} />
            </span>
            Sales Collection
          </h2>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1.5">
          {activePeriod && activePeriod !== 'ALL' && onSelectPeriod && (
            <button
              onClick={() => onSelectPeriod('ALL')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs transition-all active:scale-95"
              title="Reset filter to show all orders"
            >
              <Filter size={11} className="text-slate-400" />
              <span>All Orders</span>
            </button>
          )}

          {/* Compact / Detailed Toggle */}
          <button
            onClick={toggleCompact}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs transition-all"
            title={isCompact ? 'Switch to detailed view' : 'Switch to compact view'}
          >
            {isCompact ? (
              <>
                <Maximize2 size={11} className="text-slate-400" />
                <span className="hidden sm:inline">Detailed</span>
              </>
            ) : (
              <>
                <Minimize2 size={11} className="text-slate-400" />
                <span className="hidden sm:inline">Compact</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* COMPACT VIEW (Small & Simple Option) */}
      {isCompact ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          {cards.map(({ id, title, period }) => {
            const isSelected = activePeriod === id;

            return (
              <div
                key={id}
                onClick={() => {
                  if (onSelectPeriod) {
                    onSelectPeriod(isSelected ? 'ALL' : id);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectPeriod && onSelectPeriod(isSelected ? 'ALL' : id);
                  }
                }}
                className={`group p-3 sm:px-3.5 sm:py-3 rounded-xl border transition-all cursor-pointer bg-white flex flex-col justify-between select-none ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-500/30 shadow-xs'
                    : 'border-slate-200/80 hover:border-slate-300 hover:shadow-xs hover:bg-slate-50/40'
                }`}
              >
                {/* Top Row: Title + Order count */}
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-xs font-semibold truncate ${isSelected ? 'text-emerald-950 font-bold' : 'text-slate-600'}`}>
                      {title}
                    </span>
                    {isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium shrink-0">
                    {period.orderCount} {period.orderCount === 1 ? 'ord' : 'orders'}
                  </span>
                </div>

                {/* Bottom Row: Amount + Trend */}
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                    {formatCurrency(period.totalAmount)}
                  </span>

                  {period.percentChange !== null && period.percentChange !== 0 ? (
                    <span
                      className={`inline-flex items-center text-[10px] font-bold px-1 py-0.5 rounded shrink-0 ${
                        period.trend === 'UP'
                          ? 'text-emerald-700 bg-emerald-50'
                          : 'text-rose-700 bg-rose-50'
                      }`}
                      title={`${period.comparisonLabel}: ${formatCurrency(period.prevPeriodAmount, false)}`}
                    >
                      {period.percentChange > 0 ? `+${period.percentChange}%` : `${period.percentChange}%`}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* EXPANDED DETAILED VIEW */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {cards.map(({ id, title, period, icon: Icon }) => {
            const isSelected = activePeriod === id;

            return (
              <div
                key={id}
                onClick={() => {
                  if (onSelectPeriod) {
                    onSelectPeriod(isSelected ? 'ALL' : id);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectPeriod && onSelectPeriod(isSelected ? 'ALL' : id);
                  }
                }}
                className={`group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer bg-white flex flex-col justify-between select-none ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/20 ring-2 ring-emerald-500/20 shadow-xs'
                    : 'border-slate-200/80 hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                        {title}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                          Filtered
                        </span>
                      )}
                    </div>
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                        isSelected
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-50 text-slate-400 group-hover:text-slate-600'
                      }`}
                    >
                      <Icon size={14} />
                    </div>
                  </div>

                  <div className="my-1.5">
                    <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                      {formatCurrency(period.totalAmount)}
                    </div>
                  </div>
                </div>

                <div className="pt-2 mt-1.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                    <ShoppingBag size={12} className="text-slate-400" />
                    <span>
                      {period.orderCount} {period.orderCount === 1 ? 'order' : 'orders'}
                    </span>
                  </div>

                  <div>
                    {period.percentChange !== null ? (
                      <div
                        className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          period.trend === 'UP'
                            ? 'bg-emerald-50 text-emerald-700'
                            : period.trend === 'DOWN'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-slate-50 text-slate-600'
                        }`}
                        title={`${period.comparisonLabel}: ${formatCurrency(period.prevPeriodAmount, false)}`}
                      >
                        {period.trend === 'UP' ? (
                          <ArrowUpRight size={11} className="stroke-[2.5]" />
                        ) : period.trend === 'DOWN' ? (
                          <ArrowDownRight size={11} className="stroke-[2.5]" />
                        ) : (
                          <Minus size={11} />
                        )}
                        <span>
                          {period.percentChange > 0 ? `+${period.percentChange}%` : `${period.percentChange}%`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-normal">
                        No prior data
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

