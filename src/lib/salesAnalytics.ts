// Centralized Sales Analytics and Order Total Calculation Service
// Provides accurate order-wise total price calculation and dynamic sales collection summaries

export interface OrderPriceBreakdown {
  foodSubtotal: number;
  additionalCharges: number;
  discountAmount: number;
  totalAmount: number;
  itemCount: number;
}

export type PaymentStatusType = 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED';

export interface PaymentStatusInfo {
  status: PaymentStatusType;
  label: string;
  badgeClass: string;
}

export interface CollectionPeriodSummary {
  id: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';
  name: string;
  shortLabel: string;
  totalAmount: number;
  orderCount: number;
  prevPeriodAmount: number;
  prevPeriodOrderCount: number;
  diffAmount: number;
  percentChange: number | null; // e.g. +14.5 or -8.2
  trend: 'UP' | 'DOWN' | 'NEUTRAL';
  startDate: Date;
  endDate: Date;
  comparisonLabel: string;
}

export interface SalesCollectionDashboard {
  today: CollectionPeriodSummary;
  yesterday: CollectionPeriodSummary;
  last7Days: CollectionPeriodSummary;
  last30Days: CollectionPeriodSummary;
}

/**
 * Format a numeric amount as Indian Rupees (₹)
 * Example: 1250 -> "₹1,250.00"
 */
export const formatCurrency = (amount: number, showDecimals = true): string => {
  const safe = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(safe);
};

/**
 * Calculates the exact food price and total amount for an individual order.
 * Accurately computes item quantities * prices, plus any platform/gateway fees or discounts.
 */
export const calculateOrderTotal = (order: any): OrderPriceBreakdown => {
  if (!order) {
    return {
      foodSubtotal: 0,
      additionalCharges: 0,
      discountAmount: 0,
      totalAmount: 0,
      itemCount: 0,
    };
  }

  // 1. Calculate sum of items from order_items
  let itemsFoodSubtotal = 0;
  let itemCount = 0;

  if (Array.isArray(order.order_items)) {
    order.order_items.forEach((item: any) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const price = Number(item.menu_items?.price ?? item.price ?? 0);
      itemsFoodSubtotal += (price * qty);
      itemCount += qty;
    });
  }

  // 2. Check order_ledger for official subtotal and gross payable
  const ledger = Array.isArray(order.order_ledger) ? order.order_ledger[0] : order.order_ledger;
  const recordedFoodSubtotal = ledger?.food_subtotal != null ? Number(ledger.food_subtotal) : null;
  const recordedGross = ledger?.gross_payable != null ? Number(ledger.gross_payable) : null;
  const paymentAmount = order.payments?.amount != null ? Number(order.payments.amount) : null;

  const foodSubtotal = (recordedFoodSubtotal != null && recordedFoodSubtotal > 0)
    ? recordedFoodSubtotal
    : itemsFoodSubtotal;

  let totalAmount = foodSubtotal;
  if (paymentAmount != null && paymentAmount > 0) {
    totalAmount = paymentAmount;
  } else if (recordedGross != null && recordedGross > 0) {
    totalAmount = recordedGross;
  }

  const additionalCharges = Math.max(0, Number((totalAmount - foodSubtotal).toFixed(2)));
  const discountAmount = Math.max(0, Number(order.discount_amount || 0));

  return {
    foodSubtotal: Number(foodSubtotal.toFixed(2)),
    additionalCharges,
    discountAmount,
    totalAmount: Number(totalAmount.toFixed(2)),
    itemCount,
  };
};

/**
 * Determines the payment status of an individual order
 */
export const getOrderPaymentStatus = (order: any): PaymentStatusInfo => {
  if (!order) {
    return { status: 'PENDING', label: 'Pending', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' };
  }

  // 1. Direct payment record status
  const payStatus = order.payments?.status;
  if (payStatus === 'SUCCESS') {
    return { status: 'PAID', label: 'Paid', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  if (payStatus === 'FAILED' || payStatus === 'USER_DROPPED') {
    return { status: 'FAILED', label: 'Failed', badgeClass: 'bg-rose-50 text-rose-700 border-rose-200' };
  }
  if (payStatus === 'REFUNDED') {
    return { status: 'REFUNDED', label: 'Refunded', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200' };
  }

  // 2. Ledger status
  const ledger = Array.isArray(order.order_ledger) ? order.order_ledger[0] : order.order_ledger;
  if (ledger?.payment_status === 'SUCCESS' || ledger?.payment_status === 'PAID') {
    return { status: 'PAID', label: 'Paid', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }

  // 3. Rejected or cancelled orders
  if (order.status === 'REJECTED') {
    return { status: 'REFUNDED', label: 'Cancelled / Refunded', badgeClass: 'bg-rose-50 text-rose-700 border-rose-200' };
  }

  // 4. Completed/collected orders are confirmed paid
  if (['COLLECTED', 'READY', 'PREPARING', 'ACCEPTED'].includes(order.status)) {
    return { status: 'PAID', label: 'Paid', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }

  return { status: 'PENDING', label: 'Pending', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' };
};

/**
 * Checks if an order counts as a collected/valid sale:
 * Excludes cancelled/rejected orders and failed/refunded payments.
 */
export const isCollectedSale = (order: any): boolean => {
  if (!order) return false;
  if (order.status === 'REJECTED') return false;

  const payStatus = order.payments?.status;
  if (payStatus === 'FAILED' || payStatus === 'USER_DROPPED' || payStatus === 'REFUNDED') {
    return false;
  }

  return true;
};

// Local Timezone Helpers
const getStartOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

const getEndOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
};

/**
 * Computes sales collection statistics for a given list of orders and period.
 */
const computePeriodStats = (
  orders: any[],
  start: Date,
  end: Date
): { totalAmount: number; orderCount: number } => {
  const startMs = start.getTime();
  const endMs = end.getTime();

  let totalAmount = 0;
  let orderCount = 0;

  orders.forEach((order) => {
    if (!isCollectedSale(order)) return;

    const orderMs = new Date(order.created_at).getTime();
    if (orderMs >= startMs && orderMs <= endMs) {
      const { totalAmount: amt } = calculateOrderTotal(order);
      totalAmount += amt;
      orderCount += 1;
    }
  });

  return {
    totalAmount: Number(totalAmount.toFixed(2)),
    orderCount,
  };
};

/**
 * Computes comparison trend (% change and difference)
 */
const computeComparison = (currentAmt: number, prevAmt: number) => {
  const diffAmount = Number((currentAmt - prevAmt).toFixed(2));
  let percentChange: number | null = null;

  if (prevAmt > 0) {
    percentChange = Number((((currentAmt - prevAmt) / prevAmt) * 100).toFixed(1));
  } else if (currentAmt > 0) {
    percentChange = 100.0;
  }

  const trend: 'UP' | 'DOWN' | 'NEUTRAL' =
    diffAmount > 0 ? 'UP' : diffAmount < 0 ? 'DOWN' : 'NEUTRAL';

  return { diffAmount, percentChange, trend };
};

/**
 * Computes the complete 4-period Sales Collection Summary Dashboard:
 * 1. Today's Collection (compared to Yesterday)
 * 2. Yesterday's Collection (compared to Day Before Yesterday)
 * 3. Last 7 Days Collection (compared to Previous 7 Days)
 * 4. Last 30 Days Collection (compared to Previous 30 Days)
 */
export const computeSalesCollectionSummary = (orders: any[]): SalesCollectionDashboard => {
  const now = new Date();

  // 1. TODAY & YESTERDAY
  const todayStart = getStartOfDay(now);
  const todayEnd = getEndOfDay(now);

  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStart = getStartOfDay(yesterdayDate);
  const yesterdayEnd = getEndOfDay(yesterdayDate);

  const dbyDate = new Date(now);
  dbyDate.setDate(dbyDate.getDate() - 2);
  const dbyStart = getStartOfDay(dbyDate);
  const dbyEnd = getEndOfDay(dbyDate);

  // 2. LAST 7 DAYS & PREVIOUS 7 DAYS
  const l7Date = new Date(now);
  l7Date.setDate(l7Date.getDate() - 6);
  const last7DaysStart = getStartOfDay(l7Date);
  const last7DaysEnd = todayEnd;

  const prev7EndDate = new Date(last7DaysStart);
  prev7EndDate.setMilliseconds(-1);
  const prev7StartDate = new Date(last7DaysStart);
  prev7StartDate.setDate(prev7StartDate.getDate() - 7);

  // 3. LAST 30 DAYS & PREVIOUS 30 DAYS
  const l30Date = new Date(now);
  l30Date.setDate(l30Date.getDate() - 29);
  const last30DaysStart = getStartOfDay(l30Date);
  const last30DaysEnd = todayEnd;

  const prev30EndDate = new Date(last30DaysStart);
  prev30EndDate.setMilliseconds(-1);
  const prev30StartDate = new Date(last30DaysStart);
  prev30StartDate.setDate(prev30StartDate.getDate() - 30);

  // Calculate Current and Comparison periods
  const todayStats = computePeriodStats(orders, todayStart, todayEnd);
  const yesterdayStats = computePeriodStats(orders, yesterdayStart, yesterdayEnd);
  const dbyStats = computePeriodStats(orders, dbyStart, dbyEnd);

  const last7Stats = computePeriodStats(orders, last7DaysStart, last7DaysEnd);
  const prev7Stats = computePeriodStats(orders, prev7StartDate, prev7EndDate);

  const last30Stats = computePeriodStats(orders, last30DaysStart, last30DaysEnd);
  const prev30Stats = computePeriodStats(orders, prev30StartDate, prev30EndDate);

  const todayComp = computeComparison(todayStats.totalAmount, yesterdayStats.totalAmount);
  const yesterdayComp = computeComparison(yesterdayStats.totalAmount, dbyStats.totalAmount);
  const last7Comp = computeComparison(last7Stats.totalAmount, prev7Stats.totalAmount);
  const last30Comp = computeComparison(last30Stats.totalAmount, prev30Stats.totalAmount);

  return {
    today: {
      id: 'TODAY',
      name: "Today's Collection",
      shortLabel: 'Today',
      totalAmount: todayStats.totalAmount,
      orderCount: todayStats.orderCount,
      prevPeriodAmount: yesterdayStats.totalAmount,
      prevPeriodOrderCount: yesterdayStats.orderCount,
      diffAmount: todayComp.diffAmount,
      percentChange: todayComp.percentChange,
      trend: todayComp.trend,
      startDate: todayStart,
      endDate: todayEnd,
      comparisonLabel: 'vs yesterday',
    },
    yesterday: {
      id: 'YESTERDAY',
      name: "Yesterday's Collection",
      shortLabel: 'Yesterday',
      totalAmount: yesterdayStats.totalAmount,
      orderCount: yesterdayStats.orderCount,
      prevPeriodAmount: dbyStats.totalAmount,
      prevPeriodOrderCount: dbyStats.orderCount,
      diffAmount: yesterdayComp.diffAmount,
      percentChange: yesterdayComp.percentChange,
      trend: yesterdayComp.trend,
      startDate: yesterdayStart,
      endDate: yesterdayEnd,
      comparisonLabel: 'vs prev day',
    },
    last7Days: {
      id: 'LAST_7_DAYS',
      name: 'Last 7 Days Collection',
      shortLabel: '7 Days',
      totalAmount: last7Stats.totalAmount,
      orderCount: last7Stats.orderCount,
      prevPeriodAmount: prev7Stats.totalAmount,
      prevPeriodOrderCount: prev7Stats.orderCount,
      diffAmount: last7Comp.diffAmount,
      percentChange: last7Comp.percentChange,
      trend: last7Comp.trend,
      startDate: last7DaysStart,
      endDate: last7DaysEnd,
      comparisonLabel: 'vs prior 7 days',
    },
    last30Days: {
      id: 'LAST_30_DAYS',
      name: 'Last 30 Days Collection',
      shortLabel: '30 Days',
      totalAmount: last30Stats.totalAmount,
      orderCount: last30Stats.orderCount,
      prevPeriodAmount: prev30Stats.totalAmount,
      prevPeriodOrderCount: prev30Stats.orderCount,
      diffAmount: last30Comp.diffAmount,
      percentChange: last30Comp.percentChange,
      trend: last30Comp.trend,
      startDate: last30DaysStart,
      endDate: last30DaysEnd,
      comparisonLabel: 'vs prior 30 days',
    },
  };
};
