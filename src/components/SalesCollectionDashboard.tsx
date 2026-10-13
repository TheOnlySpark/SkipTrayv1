import React from 'react';
import {
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  ShoppingBag,
  IndianRupee,
  CalendarDays,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Filter
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
}

export const SalesCollectionDashboard: React.FC<SalesCollectionDashboardProps> = ({
  data,
  isLoading = false,
  activePeriod = 'TODAY',
  onSelectPeriod
}) => {
  const cards: {
    period: CollectionPeriodSummary;
    icon: React.ComponentType<{ className?: string; size?: number }>;
    bgGradient: string;
    borderColor: string;
    iconBg: string;
    iconColor: string;
    accentColor: string;
  }[] = [
    {
      period: data.today,
      icon: Sparkles,
      bgGradient: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
      borderColor: 'border-emerald-200 hover:border-emerald-400',
      iconBg: 'bg-emerald-100 text-emerald-700',
      iconColor: 'text-emerald-700',
      accentColor: 'text-emerald-600',
    },
    {
      period: data.yesterday,
      icon: Clock,
      bgGradient: 'from-blue-500/10 via-blue-500/5 to-transparent',
      borderColor: 'border-blue-200 hover:border-blue-400',
      iconBg: 'bg-blue-100 text-blue-700',
      iconColor: 'text-blue-700',
      accentColor: 'text-blue-600',
    },
    {
      period: data.last7Days,
      icon: CalendarDays,
      bgGradient: 'from-indigo-500/10 via-indigo-500/5 to-transparent',
      borderColor: 'border-indigo-200 hover:border-indigo-400',
      iconBg: 'bg-indigo-100 text-indigo-700',
      iconColor: 'text-indigo-700',
      accentColor: 'text-indigo-600',
    },
    {
      period: data.last30Days,
      icon: TrendingUp,
      bgGradient: 'from-purple-500/10 via-purple-500/5 to-transparent',
      borderColor: 'border-purple-200 hover:border-purple-400',
      iconBg: 'bg-purple-100 text-purple-700',
      iconColor: 'text-purple-700',
      accentColor: 'text-purple-600',
    },
  ];

  if (isLoading) {
    return (
      <div className="col-span-12 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 w-56 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(idx => (
            <div
              key={idx}
              className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3 animate-pulse"
            >
              <div className="flex justify-between items-center">
                <div className="h-4 w-28 bg-slate-200 rounded" />
                <div className="h-8 w-8 bg-slate-200 rounded-xl" />
              </div>
              <div className="h-8 w-36 bg-slate-200 rounded" />
              <div className="h-4 w-24 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="col-span-12 mb-6 space-y-4">
      {/* Header and Filter Helper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800">
                <IndianRupee size={18} />
              </span>
              Sales Collection Summary
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Live IST
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time verified revenue from completed and paid orders across time periods. Click any card to filter the Order List.
          </p>
        </div>

        {activePeriod && activePeriod !== 'ALL' && onSelectPeriod && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSelectPeriod('ALL')}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5"
              title="Show all orders without period restriction"
            >
              <Filter size={13} />
              <span>Show All Time</span>
            </button>
          </div>
        )}
      </div>

      {/* 4 Summary Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ period, icon: Icon, bgGradient, borderColor, iconBg, accentColor }) => {
          const isSelected = activePeriod === period.id;

          return (
            <div
              key={period.id}
              onClick={() => onSelectPeriod && onSelectPeriod(period.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectPeriod && onSelectPeriod(period.id);
                }
              }}
              className={`group relative p-5 rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden bg-white shadow-sm hover:shadow-md flex flex-col justify-between ${
                isSelected
                  ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/20'
                  : borderColor
              }`}
            >
              {/* Subtle gradient wash */}
              <div
                className={`absolute inset-0 bg-gradient-to-br ${bgGradient} opacity-60 pointer-events-none transition-opacity group-hover:opacity-100`}
              />

              <div className="relative z-10">
                {/* Top Row: Period Name and Icon */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                      {period.shortLabel}
                    </span>
                    <h3 className="text-sm font-extrabold text-slate-900 group-hover:text-emerald-700 transition-colors">
                      {period.name}
                    </h3>
                  </div>
                  <div className={`p-2.5 rounded-xl ${iconBg} shadow-xs shrink-0 transition-transform group-hover:scale-105`}>
                    <Icon size={18} />
                  </div>
                </div>

                {/* Amount */}
                <div className="mt-2 mb-2">
                  <div className="text-2xl sm:text-[26px] font-black text-slate-900 tracking-tight">
                    {formatCurrency(period.totalAmount)}
                  </div>
                </div>

                {/* Order count pill */}
                <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[11px]">
                    <ShoppingBag size={11} className="text-slate-500" />
                    {period.orderCount} {period.orderCount === 1 ? 'order' : 'orders'}
                  </span>
                  {isSelected && (
                    <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                      Filtered
                    </span>
                  )}
                </div>
              </div>

              {/* Bottom: Period Comparison */}
              <div className="relative z-10 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                {period.percentChange !== null ? (
                  <div className="flex items-center gap-1">
                    <span
                      className={`inline-flex items-center gap-0.5 font-bold px-1.5 py-0.5 rounded text-[10px] ${
                        period.trend === 'UP'
                          ? 'bg-emerald-50 text-emerald-700'
                          : period.trend === 'DOWN'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {period.trend === 'UP' ? (
                        <ArrowUpRight size={12} className="stroke-[2.5]" />
                      ) : period.trend === 'DOWN' ? (
                        <ArrowDownRight size={12} className="stroke-[2.5]" />
                      ) : (
                        <Minus size={12} />
                      )}
                      <span>
                        {period.percentChange > 0 ? `+${period.percentChange}%` : `${period.percentChange}%`}
                      </span>
                    </span>
                    <span className="text-slate-400 font-medium">
                      {period.comparisonLabel}
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-400 italic">No prior data</span>
                )}

                <span className="text-slate-400 font-mono text-[10px]">
                  {formatCurrency(period.prevPeriodAmount, false)} prev
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
