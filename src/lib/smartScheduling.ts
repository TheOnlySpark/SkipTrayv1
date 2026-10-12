// Smart Preparation Scheduling Engine for SkipTray Canteen
import { supabase } from './supabase';
import { formatSingleTime, parseTimeToMinutes, minutesToTimeString, LunchSlotConfig } from './lunchSlots';

export interface ScheduledCartItem {
  id: string;
  quantity: number;
  prep_time_minutes?: number | null;
  name?: string;
}

export interface OrderScheduleResult {
  isAvailable: boolean;
  isValid?: boolean; // alias for isAvailable
  error?: string;
  reason?: string; // alias for error
  requestedPickupTime: string; // ISO string or time string
  pickupTimeStr: string; // "12:17"
  pickupTimeFormatted: string; // "12:17 PM"
  estimatedPrepDurationMinutes: number; // e.g. 12
  plannedPrepStartTime: string; // ISO string or time string
  prepStartFormatted: string; // "12:05 PM"
  targetReadyByTime: string; // ISO string or time string
  readyByFormatted: string; // "12:17 PM"
  suggestedPickupTime?: string; // "12:28"
  suggestedPickupFormatted?: string; // "12:28 PM"
  currentWorkloadCount?: number;
  maxCapacity?: number;
}

/**
 * Calculates estimated preparation duration based on items in cart.
 * In a commercial kitchen, items can be prepared concurrently.
 * Formula: max(item_prep_time) + 1 min buffer per additional item quantity.
 */
export function calculateOrderPrepDuration(
  items: ScheduledCartItem[],
  defaultPrepMinutes = 10
): number {
  if (!items || items.length === 0) return defaultPrepMinutes;

  let maxItemPrep = defaultPrepMinutes;
  let totalQuantity = 0;

  for (const item of items) {
    const itemPrep = Number(item.prep_time_minutes) || defaultPrepMinutes;
    if (itemPrep > maxItemPrep) {
      maxItemPrep = itemPrep;
    }
    totalQuantity += item.quantity || 1;
  }

  // Concurrency model: Primary dish prep time + 1 min per additional item (capped between 8 and 35 mins)
  const additionalItems = Math.max(0, totalQuantity - 1);
  const totalDuration = maxItemPrep + Math.min(10, additionalItems);
  return Math.min(35, Math.max(8, totalDuration));
}

/**
 * Client-side calculation & validation of preparation schedule.
 * Provides instant feedback before network round-trips.
 */
export function calculateLocalOrderSchedule(
  pickupTimeStr: string,
  items: ScheduledCartItem[],
  config: LunchSlotConfig,
  currentISTMinutes: number,
  orderDateStr?: string
): OrderScheduleResult {
  const cleanTime = pickupTimeStr.trim();
  const timeRegex = /^(\d{1,2}):(\d{2})/;
  const match = cleanTime.match(timeRegex);

  if (!match) {
    return {
      isAvailable: false,
      error: 'Please choose a valid pickup time (HH:MM).',
      requestedPickupTime: '',
      pickupTimeStr: '',
      pickupTimeFormatted: '',
      estimatedPrepDurationMinutes: 10,
      plannedPrepStartTime: '',
      prepStartFormatted: '',
      targetReadyByTime: '',
      readyByFormatted: '',
    };
  }

  const hours = match[1].padStart(2, '0');
  const minutes = match[2];
  const normalizedTime = `${hours}:${minutes}`;
  const pickupMinutes = parseTimeToMinutes(normalizedTime);

  const serviceStartMin = parseTimeToMinutes(config.serviceStartTime || '12:00');
  const serviceEndMin = parseTimeToMinutes(config.serviceEndTime || '14:00');
  const prepDuration = calculateOrderPrepDuration(items, config.defaultPrepTimeMinutes || 10);
  const plannedStartMinutes = pickupMinutes - prepDuration;

  const todayStr = orderDateStr || new Date().toISOString().split('T')[0];
  const requestedPickupIso = `${todayStr}T${normalizedTime}:00+05:30`;
  const prepStartIso = `${todayStr}T${minutesToTimeString(plannedStartMinutes)}:00+05:30`;

  // 1. Service Closed Check
  if (config.isLunchEnabled === false) {
    const err = 'Lunch ordering service is currently closed.';
    return {
      isAvailable: false,
      isValid: false,
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalizedTime,
      pickupTimeFormatted: formatSingleTime(normalizedTime),
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(plannedStartMinutes)),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formatSingleTime(normalizedTime),
    };
  }

  // 2. Service Window Bounds Check
  if (pickupMinutes < serviceStartMin) {
    const err = `Pickup time must be during lunch service hours (${formatSingleTime(config.serviceStartTime)} – ${formatSingleTime(config.serviceEndTime)}).`;
    return {
      isAvailable: false,
      isValid: false,
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalizedTime,
      pickupTimeFormatted: formatSingleTime(normalizedTime),
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(plannedStartMinutes)),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formatSingleTime(normalizedTime),
      suggestedPickupTime: config.serviceStartTime,
      suggestedPickupFormatted: formatSingleTime(config.serviceStartTime),
    };
  }

  if (pickupMinutes > serviceEndMin) {
    const err = `Pickup time cannot be after lunch closing time (${formatSingleTime(config.serviceEndTime)}).`;
    return {
      isAvailable: false,
      isValid: false,
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalizedTime,
      pickupTimeFormatted: formatSingleTime(normalizedTime),
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(plannedStartMinutes)),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formatSingleTime(normalizedTime),
      suggestedPickupTime: config.serviceEndTime,
      suggestedPickupFormatted: formatSingleTime(config.serviceEndTime),
    };
  }

  // 3. Preparation Lead Time (Preparation start time cannot be in the past)
  if (plannedStartMinutes < currentISTMinutes) {
    const earliestFeasiblePickupMin = currentISTMinutes + prepDuration + 2; // 2 min buffer
    const cappedPickupMin = Math.min(serviceEndMin, Math.max(serviceStartMin, earliestFeasiblePickupMin));
    const suggestedTimeStr = minutesToTimeString(cappedPickupMin);
    const err = `Kitchen needs ${prepDuration} minutes to prepare this order. The earliest ready time is ${formatSingleTime(suggestedTimeStr)}.`;

    return {
      isAvailable: false,
      isValid: false,
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalizedTime,
      pickupTimeFormatted: formatSingleTime(normalizedTime),
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(plannedStartMinutes)),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formatSingleTime(normalizedTime),
      suggestedPickupTime: suggestedTimeStr,
      suggestedPickupFormatted: formatSingleTime(suggestedTimeStr),
    };
  }

  return {
    isAvailable: true,
    isValid: true,
    requestedPickupTime: requestedPickupIso,
    pickupTimeStr: normalizedTime,
    pickupTimeFormatted: formatSingleTime(normalizedTime),
    estimatedPrepDurationMinutes: prepDuration,
    plannedPrepStartTime: prepStartIso,
    prepStartFormatted: formatSingleTime(minutesToTimeString(plannedStartMinutes)),
    targetReadyByTime: requestedPickupIso,
    readyByFormatted: formatSingleTime(normalizedTime),
    maxCapacity: config.maxConcurrentOrders || 15,
  };
}

/**
 * Backend-authoritative verification of schedule and kitchen capacity.
 * Invokes RPC calculate_order_schedule if available, or falls back to local computation.
 */
export async function verifyBackendOrderSchedule(
  canteenId: string | undefined,
  pickupTimeStr: string,
  items: ScheduledCartItem[],
  config: LunchSlotConfig,
  currentISTMinutes: number
): Promise<OrderScheduleResult> {
  const localResult = calculateLocalOrderSchedule(pickupTimeStr, items, config, currentISTMinutes);
  if (!localResult.isAvailable) {
    return localResult;
  }

  if (!canteenId) return localResult;

  try {
    const { data, error } = await supabase.rpc('calculate_order_schedule' as any, {
      p_canteen_id: canteenId,
      p_pickup_time_str: pickupTimeStr,
      p_items: items.map(i => ({ id: i.id, quantity: i.quantity })),
    });

    if (!error && data) {
      const resp = data as any;
      return {
        isAvailable: resp.is_available ?? true,
        isValid: resp.is_available ?? true,
        error: resp.error,
        reason: resp.error,
        requestedPickupTime: resp.requested_pickup_time || localResult.requestedPickupTime,
        pickupTimeStr: resp.pickup_time_str || localResult.pickupTimeStr,
        pickupTimeFormatted: resp.pickup_time_formatted || localResult.pickupTimeFormatted,
        estimatedPrepDurationMinutes: resp.estimated_prep_duration_minutes || localResult.estimatedPrepDurationMinutes,
        plannedPrepStartTime: resp.planned_prep_start_time || localResult.plannedPrepStartTime,
        prepStartFormatted: resp.prep_start_formatted || localResult.prepStartFormatted,
        targetReadyByTime: resp.target_ready_by_time || localResult.targetReadyByTime,
        readyByFormatted: resp.ready_by_formatted || localResult.readyByFormatted,
        suggestedPickupTime: resp.suggested_pickup_time,
        suggestedPickupFormatted: resp.suggested_pickup_formatted,
        currentWorkloadCount: resp.current_workload_count,
        maxCapacity: resp.max_capacity || localResult.maxCapacity,
      };
    }
  } catch (err) {
    console.warn('RPC calculate_order_schedule unavailable, using authoritative local calculation:', err);
  }

  return localResult;
}

/**
 * Calculates preparation urgency and countdown status for kitchen staff.
 */
export function getPrepUrgencyStatus(
  order: {
    status: string;
    pickup_time?: string | null;
    planned_prep_start_time?: string | null;
    requested_pickup_time?: string | null;
    created_at?: string | null;
  },
  currentTimeMs: number
): {
  stage: 'UPCOMING' | 'START_NOW' | 'COOKING' | 'READY' | 'OVERDUE' | 'COLLECTED';
  minutesRemaining: number;
  label: string;
  badgeClass: string;
} {
  if (order.status === 'COLLECTED') {
    return {
      stage: 'COLLECTED',
      minutesRemaining: 0,
      label: 'Collected',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
    };
  }

  if (order.status === 'READY') {
    return {
      stage: 'READY',
      minutesRemaining: 0,
      label: 'Ready for Pickup',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }

  if (order.status === 'PREPARING') {
    return {
      stage: 'COOKING',
      minutesRemaining: 0,
      label: 'In Kitchen (Cooking)',
      badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    };
  }

  // For PLACED / ACCEPTED orders: Check against planned prep start time
  let prepStartMs: number | null = null;

  if (order.planned_prep_start_time) {
    prepStartMs = new Date(order.planned_prep_start_time).getTime();
  } else if (order.pickup_time) {
    // Derive from pickup_time string (subtract 12 minutes)
    try {
      const match = order.pickup_time.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const createdDate = order.created_at ? new Date(order.created_at) : new Date(currentTimeMs);
        const targetDate = new Date(createdDate);
        targetDate.setHours(h, m, 0, 0);
        prepStartMs = targetDate.getTime() - 12 * 60 * 1000;
      }
    } catch {
      // ignore
    }
  }

  if (!prepStartMs || isNaN(prepStartMs)) {
    return {
      stage: 'UPCOMING',
      minutesRemaining: 0,
      label: 'Scheduled',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    };
  }

  const diffMs = prepStartMs - currentTimeMs;
  const minutesDiff = Math.round(diffMs / 60000);

  if (minutesDiff > 0) {
    return {
      stage: 'UPCOMING',
      minutesRemaining: minutesDiff,
      label: `Starts in ${minutesDiff}m`,
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    };
  } else {
    const overdueMins = Math.abs(minutesDiff);
    return {
      stage: 'START_NOW',
      minutesRemaining: overdueMins,
      label: overdueMins === 0 ? '⚡ Start Prep Now' : `⚠️ Start Prep (${overdueMins}m overdue)`,
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-extrabold animate-pulse',
    };
  }
}
