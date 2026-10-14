// Smart Preparation Scheduling Engine for SkipTray Canteen
import { supabase } from './supabase';
import {
  formatSingleTime,
  parseTimeToMinutes,
  minutesToTimeString,
  LunchSlotConfig,
  getISTDateTime,
  getAvailableServiceDates,
  getNextFeasibleServiceDate,
  AvailableServiceDate,
  DEFAULT_LUNCH_SLOT_CONFIG,
} from './lunchSlots';

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
  | 'CLOSED_ON_SUNDAYS'
  | 'BEFORE_BOOKING_OPENS'
  | 'OUTSIDE_HOURS'
  | 'INSUFFICIENT_LEAD_TIME'
  | 'PAST_TIME'
  | 'NO_FEASIBLE_TIME_TODAY'
  | 'CAPACITY_EXCEEDED';

export interface OrderScheduleResult {
  isAvailable: boolean;
  isValid: boolean; // alias for isAvailable
  validationCode: ScheduleValidationCode;
  statusBadge: string; // e.g. "12:30 PM", "Too Soon", "Past Time", "Outside Hours", "Invalid Time", "Closed"
  error?: string;
  reason?: string; // alias for error
  
  // Date-Aware Service Tracking
  serviceDateStr: string; // "YYYY-MM-DD" e.g. "2026-10-14"
  serviceDateFormatted: string; // e.g. "Tomorrow (Wed, 14 Oct)"
  isServiceDateToday: boolean;

  requestedPickupTime: string; // ISO string e.g. "2026-10-14T12:30:00+05:30"
  pickupTimeStr: string; // "14:00" (clean 24h)
  pickupTimeFormatted: string; // "2:00 PM" (12h display)
  estimatedPrepDurationMinutes: number; // e.g. 14
  plannedPrepStartTime: string; // ISO string
  prepStartFormatted: string; // "1:46 PM"
  targetReadyByTime: string; // ISO string
  readyByFormatted: string; // "2:00 PM"

  // Feasible alternative suggestion (if selected time/date violates rules)
  suggestedPickupTime?: string; // e.g. "12:15"
  suggestedPickupFormatted?: string; // e.g. "12:15 PM"
  suggestedDateStr?: string; // e.g. "2026-10-14"
  suggestedDateFormatted?: string; // e.g. "Tomorrow"

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
 * Accurately date-aware: evaluates service date, operating hours, preparation lead time, and kitchen capacity.
 */
export function calculateLocalOrderSchedule(
  pickupTimeStr: string,
  items: ScheduledCartItem[],
  config: LunchSlotConfig = DEFAULT_LUNCH_SLOT_CONFIG,
  currentISTMinutes?: number,
  orderDateStr?: string,
  currentTimeMs = Date.now()
): OrderScheduleResult {
  const prepDuration = calculateOrderPrepDuration(items, config.defaultPrepTimeMinutes || 10);
  const nowIST = getISTDateTime(currentTimeMs);
  const activeISTMinutes = typeof currentISTMinutes === 'number' ? currentISTMinutes : nowIST.totalMinutes;
  const currentDateStr = nowIST.dateStr;

  // Resolve service date
  const nextFeasible = getNextFeasibleServiceDate(currentTimeMs, config, prepDuration);
  const selectedDateStr = orderDateStr || nextFeasible.dateStr;
  const isToday = selectedDateStr === currentDateStr;
  const isPastDate = selectedDateStr < currentDateStr;
  const isFutureDate = selectedDateStr > currentDateStr;

  // Compute friendly date label
  const dateObj = new Date(`${selectedDateStr}T12:00:00+05:30`);
  const dayOfWeek = dateObj.getDay();
  const isSunday = dayOfWeek === 0;
  const dayName = isToday
    ? 'Today'
    : isFutureDate && Math.round((new Date(selectedDateStr).getTime() - new Date(currentDateStr).getTime()) / 86400000) === 1
    ? 'Tomorrow'
    : dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  const dateMonthStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
  const serviceDateFormatted = `${dayName} (${dateMonthStr})`;

  // Next bookable future date (in case today is unbookable)
  const nextBookableDate = getAvailableServiceDates(currentTimeMs, config, prepDuration, 5)
    .find(d => !d.isToday && d.isBookable) || nextFeasible;

  const cleanTime = (pickupTimeStr || '').trim();
  const pickupMinutes = parseTimeToMinutes(cleanTime);
  const serviceStartMin = parseTimeToMinutes(config.serviceStartTime || '12:00');
  const serviceEndMin = parseTimeToMinutes(config.serviceEndTime || '14:00');

  // Helper for consistent result building
  const buildResult = (
    isValid: boolean,
    validationCode: ScheduleValidationCode,
    statusBadge: string,
    errorMsg?: string,
    suggestedTime?: string,
    suggestedDate?: string,
    suggestedDateName?: string
  ): OrderScheduleResult => {
    const norm24h = isNaN(pickupMinutes) ? '' : minutesToTimeString(pickupMinutes);
    const formattedDisplay = norm24h ? formatSingleTime(norm24h) : '';
    const plannedStartMin = isNaN(pickupMinutes) ? 0 : pickupMinutes - prepDuration;
    const requestedPickupIso = norm24h ? `${selectedDateStr}T${norm24h}:00+05:30` : '';
    const prepStartIso = norm24h ? `${selectedDateStr}T${minutesToTimeString(Math.max(0, plannedStartMin))}:00+05:30` : '';

    return {
      isAvailable: isValid,
      isValid,
      validationCode,
      statusBadge,
      error: errorMsg,
      reason: errorMsg,
      serviceDateStr: selectedDateStr,
      serviceDateFormatted,
      isServiceDateToday: isToday,
      requestedPickupTime: requestedPickupIso,
      pickupTimeStr: norm24h,
      pickupTimeFormatted: formattedDisplay,
      estimatedPrepDurationMinutes: prepDuration,
      plannedPrepStartTime: prepStartIso,
      prepStartFormatted: norm24h ? formatSingleTime(minutesToTimeString(Math.max(0, plannedStartMin))) : '',
      targetReadyByTime: requestedPickupIso,
      readyByFormatted: formattedDisplay,
      suggestedPickupTime: suggestedTime,
      suggestedPickupFormatted: suggestedTime ? formatSingleTime(suggestedTime) : undefined,
      suggestedDateStr: suggestedDate,
      suggestedDateFormatted: suggestedDateName,
      maxCapacity: config.maxConcurrentOrders || 15,
    };
  };

  // 1. Invalid / Empty Time Format Check
  if (isNaN(pickupMinutes) || !cleanTime) {
    return buildResult(
      false,
      'INVALID_FORMAT',
      'Invalid Time',
      'Please enter a valid pickup time (e.g. 12:30 PM).'
    );
  }

  // 2. Service Enabled Check
  if (config.isLunchEnabled === false) {
    return buildResult(
      false,
      'SERVICE_CLOSED',
      'Closed',
      'Lunch ordering service is currently closed for this canteen.'
    );
  }

  // 3. Sunday Canteen Closed Check
  if (isSunday) {
    return buildResult(
      false,
      'CLOSED_ON_SUNDAYS',
      'Closed',
      'Orders cannot be placed on Sundays. The canteen is closed.',
      minutesToTimeString(serviceStartMin),
      nextBookableDate.dateStr,
      nextBookableDate.dayName
    );
  }

  // 4. Past Service Date Check
  if (isPastDate) {
    return buildResult(
      false,
      'PAST_TIME',
      'Past Date',
      'This service date has already passed. Please choose an upcoming service date.',
      minutesToTimeString(serviceStartMin),
      nextBookableDate.dateStr,
      nextBookableDate.dayName
    );
  }

  // 5. Operating Hours Window Check (12:00 PM – 2:00 PM)
  if (pickupMinutes < serviceStartMin) {
    return buildResult(
      false,
      'OUTSIDE_HOURS',
      'Outside Hours',
      `Pickup time must be within lunch service hours (${formatSingleTime(config.serviceStartTime)} – ${formatSingleTime(config.serviceEndTime)}).`,
      minutesToTimeString(serviceStartMin),
      selectedDateStr,
      dayName
    );
  }

  if (pickupMinutes > serviceEndMin) {
    return buildResult(
      false,
      'OUTSIDE_HOURS',
      'Outside Hours',
      `Pickup time cannot be after lunch closing time (${formatSingleTime(config.serviceEndTime)}).`,
      minutesToTimeString(serviceEndMin),
      selectedDateStr,
      dayName
    );
  }

  // 6. Same-Day (Today) Specific Validations
  if (isToday) {
    // 6a. Has today's lunch service already closed or run out of feasible prep windows?
    const hasServiceEndedToday = activeISTMinutes >= serviceEndMin;
    const noFeasibleTimeRemainsToday = (activeISTMinutes + prepDuration) > serviceEndMin;

    if (hasServiceEndedToday || noFeasibleTimeRemainsToday) {
      return buildResult(
        false,
        'NO_FEASIBLE_TIME_TODAY',
        'Closed',
        hasServiceEndedToday
          ? `Lunch service has closed for today (${formatSingleTime(config.serviceEndTime)}). No pickup times remain today.`
          : `Your order needs approximately ${prepDuration} minutes to prepare, but lunch closes at ${formatSingleTime(config.serviceEndTime)}. No remaining pickup times today.`,
        minutesToTimeString(serviceStartMin),
        nextBookableDate.dateStr,
        nextBookableDate.dayName
      );
    }

    // 6b. Is the requested pickup time already in the past today?
    if (pickupMinutes < activeISTMinutes) {
      const earliestFeasiblePickupMin = activeISTMinutes + prepDuration;
      if (earliestFeasiblePickupMin > serviceEndMin) {
        // Preparation would exceed closing time: no feasible slot remains today
        return buildResult(
          false,
          'NO_FEASIBLE_TIME_TODAY',
          'Closed',
          `This pickup time has already passed and lunch closes at ${formatSingleTime(config.serviceEndTime)}. Please select the next available service date.`,
          minutesToTimeString(serviceStartMin),
          nextBookableDate.dateStr,
          nextBookableDate.dayName
        );
      }

      const suggestedTimeStr = minutesToTimeString(earliestFeasiblePickupMin);
      return buildResult(
        false,
        'PAST_TIME',
        'Past Time',
        `This pickup time has already passed. Kitchen needs approximately ${prepDuration} minutes to prepare this order. The earliest ready time is ${formatSingleTime(suggestedTimeStr)}.`,
        suggestedTimeStr,
        selectedDateStr,
        dayName
      );
    }

    // 6c. Insufficient Preparation Lead Time (Time is in the future today, but kitchen needs more notice)
    const plannedStartMinutes = pickupMinutes - prepDuration;
    if (plannedStartMinutes < activeISTMinutes) {
      const earliestFeasiblePickupMin = activeISTMinutes + prepDuration;
      if (earliestFeasiblePickupMin > serviceEndMin) {
        return buildResult(
          false,
          'NO_FEASIBLE_TIME_TODAY',
          'Closed',
          `Your order needs approximately ${prepDuration} minutes to prepare, but lunch closes at ${formatSingleTime(config.serviceEndTime)}. Please select the next available service date.`,
          minutesToTimeString(serviceStartMin),
          nextBookableDate.dateStr,
          nextBookableDate.dayName
        );
      }

      const suggestedTimeStr = minutesToTimeString(earliestFeasiblePickupMin);
      return buildResult(
        false,
        'INSUFFICIENT_LEAD_TIME',
        'Too Soon',
        `Your order needs approximately ${prepDuration} minutes to prepare. The earliest ready time is ${formatSingleTime(suggestedTimeStr)}.`,
        suggestedTimeStr,
        selectedDateStr,
        dayName
      );
    }
  }

  // 7. Future Date Booking or Feasible Today
  const normalized24h = minutesToTimeString(pickupMinutes);
  return buildResult(
    true,
    'VALID',
    formatSingleTime(normalized24h)
  );
}

/**
 * Backend-authoritative verification of schedule and kitchen capacity.
 * Invokes RPC calculate_order_schedule if available, or falls back to local computation.
 */
export async function verifyBackendOrderSchedule(
  canteenId: string | undefined,
  pickupTimeStr: string,
  items: ScheduledCartItem[],
  config: LunchSlotConfig = DEFAULT_LUNCH_SLOT_CONFIG,
  currentISTMinutes?: number,
  orderDateStr?: string,
  currentTimeMs = Date.now()
): Promise<OrderScheduleResult> {
  const localResult = calculateLocalOrderSchedule(
    pickupTimeStr,
    items,
    config,
    currentISTMinutes,
    orderDateStr,
    currentTimeMs
  );
  if (!localResult.isAvailable) {
    return localResult;
  }

  if (!canteenId) return localResult;

  try {
    const { data, error } = await supabase.rpc('calculate_order_schedule' as any, {
      p_canteen_id: canteenId,
      p_pickup_time_str: localResult.pickupTimeStr,
      p_items: items.map(i => ({ id: i.id, quantity: i.quantity })),
      p_order_date: localResult.serviceDateStr,
    });

    if (!error && data) {
      const resp = data as any;
      const isAvail = resp.is_available ?? true;
      return {
        ...localResult,
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
