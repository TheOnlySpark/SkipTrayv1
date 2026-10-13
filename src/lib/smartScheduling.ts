// Smart Preparation Scheduling Engine for SkipTray Canteen
import { supabase } from './supabase';
import { formatSingleTime, parseTimeToMinutes, minutesToTimeString, LunchSlotConfig } from './lunchSlots';

export interface ScheduledCartItem {
  id: string;
  quantity: number;
  prep_time_minutes?: number | null;
  name?: string;
}

export type ScheduleValidationCode =
  | 'VALID'
  | 'INVALID_FORMAT'
  | 'SERVICE_CLOSED'
  | 'OUTSIDE_HOURS'
  | 'INSUFFICIENT_LEAD_TIME'
  | 'PAST_TIME'
  | 'CAPACITY_EXCEEDED';

export interface OrderScheduleResult {
  isAvailable: boolean;
  isValid: boolean; // alias for isAvailable
  validationCode: ScheduleValidationCode;
  statusBadge: string; // e.g. "12:30 PM", "Too Soon", "Past Time", "Outside Hours", "Invalid Time", "Closed"
  error?: string;
  reason?: string; // alias for error
  requestedPickupTime: string; // ISO string or time string
  pickupTimeStr: string; // "14:00" (clean 24h)
  pickupTimeFormatted: string; // "2:00 PM" (12h display)
  estimatedPrepDurationMinutes: number; // e.g. 14
  plannedPrepStartTime: string; // ISO string
  prepStartFormatted: string; // "1:46 PM"
  targetReadyByTime: string; // ISO string
  readyByFormatted: string; // "2:00 PM"
  suggestedPickupTime?: string; // "14:00" (clean 24h)
  suggestedPickupFormatted?: string; // "2:00 PM"
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
  const cleanTime = (pickupTimeStr || '').trim();
  const pickupMinutes = parseTimeToMinutes(cleanTime);
  const prepDuration = calculateOrderPrepDuration(items, config.defaultPrepTimeMinutes || 10);
  const serviceStartMin = parseTimeToMinutes(config.serviceStartTime || '12:00');
  const serviceEndMin = parseTimeToMinutes(config.serviceEndTime || '14:00');
  const todayStr = orderDateStr || new Date().toISOString().split('T')[0];

  // 1. Invalid or Empty Format
  if (isNaN(pickupMinutes) || !cleanTime) {
    return {
      isAvailable: false,
      isValid: false,
      validationCode: 'INVALID_FORMAT',
      statusBadge: 'Invalid Time',
      error: 'Please choose a valid pickup time (e.g. 12:30 PM).',
      reason: 'Please choose a valid pickup time (e.g. 12:30 PM).',
      requestedPickupTime: '',
      pickupTimeStr: '',
      pickupTimeFormatted: '',
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: '',
      prepStartFormatted: '',
      targetReadyByTime: '',
      readyByFormatted: '',
    };
  }

  const normalized24h = minutesToTimeString(pickupMinutes);
  const formattedDisplay = formatSingleTime(normalized24h);
  const plannedStartMinutes = pickupMinutes - prepDuration;
  const requestedPickupIso = `${todayStr}T${normalized24h}:00+05:30`;
  const prepStartIso = `${todayStr}T${minutesToTimeString(Math.max(0, plannedStartMinutes))}:00+05:30`;

  // 2. Service Closed Check
  if (config.isLunchEnabled === false) {
    const err = 'Lunch ordering service is currently closed for today.';
    return {
      isAvailable: false,
      isValid: false,
      validationCode: 'SERVICE_CLOSED',
      statusBadge: 'Closed',
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalized24h,
      pickupTimeFormatted: formattedDisplay,
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(Math.max(0, plannedStartMinutes))),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formattedDisplay,
    };
  }

  // 3. Service Window Check: Before Opening
  if (pickupMinutes < serviceStartMin) {
    const err = `Pickup time must be during lunch service hours (${formatSingleTime(config.serviceStartTime)} – ${formatSingleTime(config.serviceEndTime)}).`;
    return {
      isAvailable: false,
      isValid: false,
      validationCode: 'OUTSIDE_HOURS',
      statusBadge: 'Outside Hours',
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalized24h,
      pickupTimeFormatted: formattedDisplay,
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(Math.max(0, plannedStartMinutes))),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formattedDisplay,
      suggestedPickupTime: minutesToTimeString(serviceStartMin),
      suggestedPickupFormatted: formatSingleTime(config.serviceStartTime),
    };
  }

  // 4. Service Window Check: After Closing
  if (pickupMinutes > serviceEndMin) {
    const err = `Pickup time cannot be after lunch closing time (${formatSingleTime(config.serviceEndTime)}).`;
    return {
      isAvailable: false,
      isValid: false,
      validationCode: 'OUTSIDE_HOURS',
      statusBadge: 'Outside Hours',
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalized24h,
      pickupTimeFormatted: formattedDisplay,
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(Math.max(0, plannedStartMinutes))),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formattedDisplay,
      suggestedPickupTime: minutesToTimeString(serviceEndMin),
      suggestedPickupFormatted: formatSingleTime(config.serviceEndTime),
    };
  }

  // 5. Past Time Check (Pickup time is already in the past)
  if (pickupMinutes < currentISTMinutes) {
    const earliestFeasiblePickupMin = Math.max(serviceStartMin, currentISTMinutes + prepDuration);
    const cappedPickupMin = Math.min(serviceEndMin, earliestFeasiblePickupMin);
    const suggestedTimeStr = minutesToTimeString(cappedPickupMin);
    const err = `Selected time has already passed. Kitchen needs ${prepDuration} minutes to prepare this order. The earliest ready time is ${formatSingleTime(suggestedTimeStr)}.`;

    return {
      isAvailable: false,
      isValid: false,
      validationCode: 'PAST_TIME',
      statusBadge: 'Past Time',
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalized24h,
      pickupTimeFormatted: formattedDisplay,
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(Math.max(0, plannedStartMinutes))),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formattedDisplay,
      suggestedPickupTime: suggestedTimeStr,
      suggestedPickupFormatted: formatSingleTime(suggestedTimeStr),
    };
  }

  // 6. Minimum Preparation Lead Time (Pickup is in the future, but kitchen needs more lead time)
  if (plannedStartMinutes < currentISTMinutes) {
    const earliestFeasiblePickupMin = Math.max(serviceStartMin, currentISTMinutes + prepDuration);
    const cappedPickupMin = Math.min(serviceEndMin, earliestFeasiblePickupMin);
    const suggestedTimeStr = minutesToTimeString(cappedPickupMin);
    const err = `Kitchen needs ${prepDuration} minutes to prepare this order. The earliest ready time is ${formatSingleTime(suggestedTimeStr)}.`;

    return {
      isAvailable: false,
      isValid: false,
      validationCode: 'INSUFFICIENT_LEAD_TIME',
      statusBadge: 'Too Soon',
      error: err,
      reason: err,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: normalized24h,
      pickupTimeFormatted: formattedDisplay,
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: formatSingleTime(minutesToTimeString(Math.max(0, plannedStartMinutes))),
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formattedDisplay,
      suggestedPickupTime: suggestedTimeStr,
      suggestedPickupFormatted: formatSingleTime(suggestedTimeStr),
    };
  }

  // 7. Valid and Feasible Schedule
  return {
    isAvailable: true,
    isValid: true,
    validationCode: 'VALID',
    statusBadge: formattedDisplay,
    requestedPickupTime: requestedPickupIso,
    pickupTimeStr: normalized24h,
    pickupTimeFormatted: formattedDisplay,
    estimatedPrepDurationMinutes: prepDuration,
    plannedPrepStartTime: prepStartIso,
    prepStartFormatted: formatSingleTime(minutesToTimeString(plannedStartMinutes)),
    targetReadyByTime: requestedPickupIso,
    readyByFormatted: formattedDisplay,
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
      p_pickup_time_str: localResult.pickupTimeStr,
      p_items: items.map(i => ({ id: i.id, quantity: i.quantity })),
    });

    if (!error && data) {
      const resp = data as any;
      const isAvail = resp.is_available ?? true;
      return {
        isAvailable: isAvail,
        isValid: isAvail,
        validationCode: isAvail ? 'VALID' : (resp.error?.includes('capacity') ? 'CAPACITY_EXCEEDED' : 'OUTSIDE_HOURS'),
        statusBadge: isAvail ? (resp.pickup_time_formatted || localResult.pickupTimeFormatted) : 'Unavailable',
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
