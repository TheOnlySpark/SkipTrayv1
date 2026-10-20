import { supabase } from './supabase';

export interface LunchSlot {
  value: string; // "12:00"
  label: string; // "12:00 PM"
  startTime: string; // "12:00"
  endTime: string; // "12:15"
  rangeLabel: string; // "12:00 PM – 12:15 PM"
  enabled: boolean;
  capacity?: number;
}

export interface CustomSlotItem {
  startTime: string; // "12:00"
  endTime: string;   // "12:30"
  label?: string;    // optional custom name/label
}

export interface LunchSlotConfig {
  id?: string;
  canteenId?: string | null;
  tenantId?: string | null;
  slotMode?: 'FIXED' | 'CUSTOM'; // 'FIXED' interval vs 'CUSTOM' explicit slots
  customSlots?: CustomSlotItem[]; // list of custom defined slots
  serviceStartTime: string; // "12:00"
  serviceEndTime: string; // "14:00"
  slotDurationMinutes: number; // 5, 10, 15, 20, 30
  minNoticeMinutes: number; // default 30
  isLunchEnabled: boolean;
  disabledSlots: string[]; // list of slot values that are turned off, e.g. ["12:45"]
  slotCapacities: Record<string, number>; // slot value -> capacity
  maxConcurrentOrders?: number; // max concurrent kitchen capacity, e.g. 15
  defaultPrepTimeMinutes?: number; // default preparation duration, e.g. 10
  orderCutoffMinutes?: number; // buffer before closing, e.g. 15
  updatedAt?: string;
}

export const DEFAULT_LUNCH_SLOT_CONFIG: LunchSlotConfig = {
  slotMode: 'FIXED',
  customSlots: [],
  serviceStartTime: '08:00',
  serviceEndTime: '20:00',
  slotDurationMinutes: 15,
  minNoticeMinutes: 15,
  isLunchEnabled: true,
  disabledSlots: [],
  slotCapacities: {},
  maxConcurrentOrders: 15,
  defaultPrepTimeMinutes: 10,
  orderCutoffMinutes: 15,
};

/**
 * Checks whether a given string is a valid time representation (either 24h '14:00', 12h '2:00 PM', or ISO timestamp).
 */
export const isValidTimeString = (timeStr?: string | null): boolean => {
  if (!timeStr || typeof timeStr !== 'string') return false;
  let trimmed = timeStr.trim().toUpperCase();
  if (trimmed.includes('T')) {
    trimmed = trimmed.split('T')[1].trim();
  }
  trimmed = trimmed.replace(/([+-]\d{2}:\d{2}|Z)$/, '').trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!match) return false;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const meridiem = match[3];

  if (isNaN(h) || isNaN(m) || m < 0 || m > 59) return false;
  if (meridiem) {
    return h >= 1 && h <= 12;
  }
  return h >= 0 && h <= 23;
};

/**
 * Helper to parse "HH:MM" (24h), "h:mm AM/PM" (12h), or ISO strings into total minutes from 00:00 midnight.
 * Returns NaN if input is invalid.
 */
export const parseTimeToMinutes = (timeStr?: string | null): number => {
  if (!timeStr || typeof timeStr !== 'string') return NaN;
  let trimmed = timeStr.trim().toUpperCase();
  // If it's a full ISO string with date, parse as Date object first to handle timezone correctly
  if (trimmed.includes('T')) {
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      return d.getHours() * 60 + d.getMinutes();
    }
    trimmed = trimmed.split('T')[1].trim();
  }
  trimmed = trimmed.replace(/([+-]\d{2}:\d{2}|Z)$/, '').trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(AM|PM)?$/);
  if (!match) return NaN;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const meridiem = match[3];

  if (isNaN(h) || isNaN(m) || m < 0 || m > 59) return NaN;
  if (meridiem) {
    if (h < 1 || h > 12) return NaN;
    if (meridiem === 'PM' && h < 12) h += 12;
    if (meridiem === 'AM' && h === 12) h = 0;
  } else {
    if (h < 0 || h > 23) return NaN;
  }
  return h * 60 + m;
};

/**
 * Helper to convert minutes from midnight (0-1439) into 24-hr "HH:mm".
 */
export const minutesToTimeString = (totalMinutes: number): string => {
  if (isNaN(totalMinutes) || totalMinutes < 0) return '';
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Normalizes any time representation ("2:00 PM", "14:00", "02:00 PM", ISO) into standard 24-hr "HH:mm".
 */
export const normalizeTimeTo24h = (timeStr?: string | null): string => {
  const min = parseTimeToMinutes(timeStr);
  return isNaN(min) ? '' : minutesToTimeString(min);
};

/**
 * Format any time string ('14:00', '2:00 PM', '09:30', ISO) into standard 12-hr display format ('2:00 PM', '9:30 AM').
 * Does NOT append AM/PM if already present.
 */
export const formatSingleTime = (timeStr?: string | null): string => {
  const min = parseTimeToMinutes(timeStr);
  if (isNaN(min)) {
    return typeof timeStr === 'string' ? timeStr.trim() : '';
  }
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayHour}:${String(m).padStart(2, '0')} ${period}`;
};

/**
 * Canonical alias for backwards compatibility across existing dashboard components.
 */
export const formatPickupTime = formatSingleTime;

/**
 * Format two time strings as a range: e.g. "12:00 PM – 12:15 PM"
 */
export const formatTimeRange = (startTime: string, endTime: string): string => {
  return `${formatSingleTime(startTime)} – ${formatSingleTime(endTime)}`;
  return `${formatSingleTime(startTime)} – ${formatSingleTime(endTime)}`;
};

/**
  * Calculate the end time string from start time and duration in minutes.
  */
export const calculateEndTime = (startTime: string, durationMinutes: number): string => {
  const startMin = parseTimeToMinutes(startTime);
  return minutesToTimeString(startMin + durationMinutes);
};

/**
  * Validates a user's customized pickup timing against service hours and advance notice.
  */
export const validateUserCustomPickupTiming = (
  startTime: string,
  durationMinutes: number,
  currentISTMinutes: number,
  serviceStartTime = '12:00',
  serviceEndTime = '14:00',
  minNoticeMinutes = 30
): { isValid: boolean; error?: string; endTime: string; intervalLabel: string } => {
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) {
    return {
      isValid: false,
      error: 'Please select a valid pickup start time (HH:MM).',
      endTime: '',
      intervalLabel: ''
    };
  }

  const startMin = parseTimeToMinutes(startTime);
  const endMin = startMin + durationMinutes;
  const serviceStartMin = parseTimeToMinutes(serviceStartTime);
  const serviceEndMin = parseTimeToMinutes(serviceEndTime);
  const endTime = minutesToTimeString(endMin);
  const intervalLabel = `${formatSingleTime(startTime)} – ${formatSingleTime(endTime)}`;

  // 1. Check if start time is before service starts
  if (startMin < serviceStartMin) {
    return {
      isValid: false,
      error: `Pickup start time must be at or after ${formatSingleTime(serviceStartTime)}.`,
      endTime,
      intervalLabel
    };
  }

  // 2. Check if start time is at or after service ends
  if (startMin >= serviceEndMin) {
    return {
      isValid: false,
      error: `Pickup start time must be before lunch service closes at ${formatSingleTime(serviceEndTime)}.`,
      endTime,
      intervalLabel
    };
  }

  // 3. Check if calculated end time exceeds service closing time
  if (endMin > serviceEndMin) {
    return {
      isValid: false,
      error: `Calculated pickup window (${intervalLabel}) extends past lunch closing at ${formatSingleTime(serviceEndTime)}. Please choose an earlier time or shorter duration.`,
      endTime,
      intervalLabel
    };
  }

  // 4. Check advance notice
  const diffMinutes = startMin - currentISTMinutes;
  if (diffMinutes < minNoticeMinutes) {
    const earliestTime = minutesToTimeString(currentISTMinutes + minNoticeMinutes);
    return {
      isValid: false,
      error: `Orders require at least ${minNoticeMinutes} minutes advance notice. Earliest available pickup is ${formatSingleTime(earliestTime)}.`,
      endTime,
      intervalLabel
    };
  }

  return {
    isValid: true,
    endTime,
    intervalLabel
  };
};

/**
 * Generates an array of lunch slots based on configuration.
 * Supports both FIXED interval-based generation and CUSTOM user-defined slot lists.
 * Respects duration (5, 10, 15, 20, 30 min) and strictly caps within service end time.
 */
export const generateSlotsFromConfig = (config: LunchSlotConfig): LunchSlot[] => {
  const disabledSet = new Set(config.disabledSlots || []);

  // 1. If mode is CUSTOM and custom slots are provided, generate directly from them
  if (config.slotMode === 'CUSTOM' && Array.isArray(config.customSlots) && config.customSlots.length > 0) {
    const validCustomSlots: LunchSlot[] = [];

    // Sort by startTime
    const sorted = [...config.customSlots].sort((a, b) => {
      return parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime);
    });

    for (const item of sorted) {
      if (!item.startTime || !item.endTime) continue;
      const startMin = parseTimeToMinutes(item.startTime);
      const endMin = parseTimeToMinutes(item.endTime);
      if (isNaN(startMin) || isNaN(endMin) || startMin >= endMin) continue;

      const slotStart = normalizeTimeTo24h(item.startTime);
      const slotEnd = normalizeTimeTo24h(item.endTime);
      const range = formatTimeRange(slotStart, slotEnd);

      validCustomSlots.push({
        value: slotStart,
        label: item.label ? `${item.label} (${range})` : `${formatPickupTime(slotStart)} (${range})`,
        startTime: slotStart,
        endTime: slotEnd,
        rangeLabel: range,
        enabled: !disabledSet.has(slotStart),
        capacity: config.slotCapacities?.[slotStart] ?? 50,
      });
    }

    if (validCustomSlots.length > 0) {
      return validCustomSlots;
    }
  }

  // 2. Default: FIXED interval duration mode across service hours
  const startMin = parseTimeToMinutes(config.serviceStartTime || '08:00');
  const endMin = parseTimeToMinutes(config.serviceEndTime || '20:00');
  const duration = Number(config.slotDurationMinutes) || 15;

  if (startMin >= endMin || duration <= 0) {
    return [];
  }

  const slots: LunchSlot[] = [];

  let current = startMin;
  while (current + duration <= endMin) {
    const slotStart = minutesToTimeString(current);
    const slotEnd = minutesToTimeString(current + duration);
    const range = formatTimeRange(slotStart, slotEnd);

    slots.push({
      value: slotStart,
      label: `${formatPickupTime(slotStart)} (${range})`,
      startTime: slotStart,
      endTime: slotEnd,
      rangeLabel: range,
      enabled: !disabledSet.has(slotStart),
      capacity: config.slotCapacities?.[slotStart] ?? 50,
    });

    current += duration;
  }

  return slots;
};

/**
 * Default fallback slot list matching the default configuration.
 */
export const DEFAULT_LUNCH_SLOTS = generateSlotsFromConfig(DEFAULT_LUNCH_SLOT_CONFIG);

/**
 * Legacy export for backwards compatibility
 */
export const LUNCH_SLOTS = DEFAULT_LUNCH_SLOTS;

const getCacheKey = (canteenId?: string | null) =>
  `skiptray_lunch_slot_config_${canteenId || 'default'}`;

/**
 * Fetches the lunch slot configuration for a canteen.
 * Checks localStorage cache first for speed, then queries Supabase table.
 */
export async function fetchLunchSlotConfig(canteenId?: string | null): Promise<LunchSlotConfig> {
  const cacheKey = getCacheKey(canteenId);

  // 1. Check local cache (either specific or global default fallback)
  let cachedConfig: LunchSlotConfig | null = null;
  try {
    const local = localStorage.getItem(cacheKey) || localStorage.getItem('skiptray_lunch_slot_config_default');
    if (local) {
      cachedConfig = JSON.parse(local);
    }
  } catch (e) {
    // Ignore cache parse error
  }

  // 2. Fetch from Supabase
  try {
    const baseColumns = 'id, canteen_id, tenant_id, slot_mode, custom_slots, service_start_time, service_end_time, slot_duration_minutes, min_notice_minutes, is_lunch_enabled, disabled_slots, slot_capacities, updated_at';
    let query = supabase.from('lunch_slot_configs').select(baseColumns);
    if (canteenId) {
      query = query.eq('canteen_id', canteenId);
    }
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();

    if (!error && data) {
      const parsedConfig: LunchSlotConfig = {
        id: (data as any).id,
        canteenId: (data as any).canteen_id,
        tenantId: (data as any).tenant_id,
        slotMode: (data as any).slot_mode === 'CUSTOM' ? 'CUSTOM' : 'FIXED',
        customSlots: Array.isArray((data as any).custom_slots) ? (data as any).custom_slots : [],
        serviceStartTime: (data as any).service_start_time || '08:00',
        serviceEndTime: (data as any).service_end_time || '20:00',
        slotDurationMinutes: Number((data as any).slot_duration_minutes) || 15,
        minNoticeMinutes: (data as any).min_notice_minutes !== null && (data as any).min_notice_minutes !== undefined ? Number((data as any).min_notice_minutes) : 15,
        isLunchEnabled: (data as any).is_lunch_enabled ?? true,
        disabledSlots: Array.isArray((data as any).disabled_slots) ? ((data as any).disabled_slots as string[]) : [],
        slotCapacities: typeof (data as any).slot_capacities === 'object' && (data as any).slot_capacities !== null ? ((data as any).slot_capacities as Record<string, number>) : {},
        maxConcurrentOrders: Number((data as any).max_concurrent_orders) || 15,
        defaultPrepTimeMinutes: Number((data as any).default_prep_time_minutes) || 10,
        orderCutoffMinutes: Number((data as any).order_cutoff_minutes) || 15,
        updatedAt: (data as any).updated_at,
      };

      try {
        localStorage.setItem(cacheKey, JSON.stringify(parsedConfig));
        localStorage.setItem('skiptray_lunch_slot_config_default', JSON.stringify(parsedConfig));
      } catch (err) {
        // Ignore local storage error
      }

      return parsedConfig;
    }
  } catch (err) {
    console.warn('Could not fetch lunch slot config from database, falling back:', err);
  }

  return cachedConfig || DEFAULT_LUNCH_SLOT_CONFIG;
}

/**
 * Saves and updates the lunch slot configuration in Supabase and local cache.
 */
export async function saveLunchSlotConfig(
  config: LunchSlotConfig,
  canteenId?: string | null,
  tenantId?: string | null
): Promise<{ success: boolean; error?: string }> {
  const cacheKey = getCacheKey(canteenId);

  const updatedConfig: LunchSlotConfig = {
    ...config,
    slotMode: config.slotMode || 'FIXED',
    customSlots: config.customSlots || [],
    canteenId: canteenId || config.canteenId || null,
    tenantId: tenantId || config.tenantId || null,
    updatedAt: new Date().toISOString(),
  };

  // 1. Immediately update local storage so user sees changes instantly
  try {
    localStorage.setItem(cacheKey, JSON.stringify(updatedConfig));
    localStorage.setItem('skiptray_lunch_slot_config_default', JSON.stringify(updatedConfig));
    // Broadcast storage event for other tabs/components
    window.dispatchEvent(new CustomEvent('lunch_slot_config_updated', { detail: updatedConfig }));
  } catch (e) {
    console.error('Failed to update local storage for slot config', e);
  }

  // 2. Persist to Supabase lunch_slot_configs
  try {
    const payload = {
      canteen_id: canteenId || null,
      tenant_id: tenantId || null,
      slot_mode: updatedConfig.slotMode || 'FIXED',
      custom_slots: updatedConfig.customSlots || [],
      service_start_time: updatedConfig.serviceStartTime,
      service_end_time: updatedConfig.serviceEndTime,
      slot_duration_minutes: updatedConfig.slotDurationMinutes,
      min_notice_minutes: updatedConfig.minNoticeMinutes,
      is_lunch_enabled: updatedConfig.isLunchEnabled,
      disabled_slots: updatedConfig.disabledSlots,
      slot_capacities: updatedConfig.slotCapacities,
      max_concurrent_orders: updatedConfig.maxConcurrentOrders ?? 15,
      default_prep_time_minutes: updatedConfig.defaultPrepTimeMinutes ?? 10,
      order_cutoff_minutes: updatedConfig.orderCutoffMinutes ?? 15,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (updatedConfig.id) {
      result = await supabase
        .from('lunch_slot_configs')
        .update(payload)
        .eq('id', updatedConfig.id);
    } else if (canteenId) {
      result = await supabase
        .from('lunch_slot_configs')
        .upsert(payload, { onConflict: 'canteen_id' });
    } else {
      result = await supabase
        .from('lunch_slot_configs')
        .insert(payload);
    }

    if (result.error) {
      console.warn('Database save lunch slot config error:', result.error);
      // Even if DB update fails (e.g. migration not run yet), local storage succeeded
      return { success: true };
    }

    return { success: true };
  } catch (err: any) {
    console.warn('Network error while saving lunch slot config:', err);
    return { success: true }; // Fallback to local persistence succeeded
  }
}

/**
 * Validates a selected pickup slot against the active configuration and time constraints.
 */
export function validateSlotSelection(
  slotValue: string,
  config: LunchSlotConfig,
  currentISTMinutes: number,
  isTestingMode = false
): { isAvailable: boolean; reason: string } {
  if (!config.isLunchEnabled) {
    return { isAvailable: false, reason: 'Lunch service is currently closed' };
  }

  if (config.disabledSlots?.includes(slotValue)) {
    return { isAvailable: false, reason: 'Slot disabled by canteen admin' };
  }

  const slotMinutes = parseTimeToMinutes(slotValue);
  const startMin = parseTimeToMinutes(config.serviceStartTime);
  const endMin = parseTimeToMinutes(config.serviceEndTime);

  if (slotMinutes < startMin || slotMinutes >= endMin) {
    return { isAvailable: false, reason: 'Outside lunch service hours' };
  }

  // Check minimum booking notice (e.g. 30 mins) unless testing
  if (!isTestingMode) {
    const diffMinutes = slotMinutes - currentISTMinutes;
    const minNotice = config.minNoticeMinutes ?? 30;
    if (diffMinutes < minNotice) {
      return {
        isAvailable: false,
        reason: `Requires at least ${minNotice}m advance notice`,
      };
    }
  }

  return { isAvailable: true, reason: '' };
}

export interface ISTDateTime {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0=Sunday, 1=Monday...
  hours: number;
  minutes: number;
  totalMinutes: number; // minutes from midnight (0-1439)
  dateStr: string; // "YYYY-MM-DD"
  timeStr: string; // "HH:mm"
  formattedDisplay: string; // "h:mm AM/PM"
  timestampMs: number;
}

/**
 * Derives authoritative Indian Standard Time (IST, UTC+05:30) date & time information.
 */
export function getISTDateTime(currentTimeMs = Date.now()): ISTDateTime {
  const d = new Date(currentTimeMs);
  const istString = d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istString);
  const year = istDate.getFullYear();
  const month = istDate.getMonth() + 1;
  const day = istDate.getDate();
  const dayOfWeek = istDate.getDay();
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return {
    year,
    month,
    day,
    dayOfWeek,
    hours,
    minutes,
    totalMinutes,
    dateStr,
    timeStr,
    formattedDisplay: formatSingleTime(timeStr),
    timestampMs: currentTimeMs,
  };
}

export interface AvailableServiceDate {
  dateStr: string; // "2026-10-14"
  dayName: string; // "Today", "Tomorrow", "Thursday"
  displayLabel: string; // "Wed, 14 Oct"
  fullLabel: string; // "Today (Tue, 13 Oct)"
  isToday: boolean;
  isBookable: boolean;
  unbookableReason?: string;
}

/**
 * Returns available service dates (Today + next days) based on canteen business rules.
 */
export function getAvailableServiceDates(
  currentTimeMs = Date.now(),
  config: LunchSlotConfig = DEFAULT_LUNCH_SLOT_CONFIG,
  prepDurationMinutes = 10,
  maxDaysAhead = 3
): AvailableServiceDate[] {
  const todayIST = getISTDateTime(currentTimeMs);
  const serviceEndMin = parseTimeToMinutes(config.serviceEndTime || '14:00');

  const dates: AvailableServiceDate[] = [];

  for (let i = 0; i <= maxDaysAhead; i++) {
    const targetMs = currentTimeMs + i * 24 * 60 * 60 * 1000;
    const targetIST = getISTDateTime(targetMs);

    const isToday = i === 0;
    const isSunday = targetIST.dayOfWeek === 0;

    const dayName = isToday ? 'Today' : i === 1 ? 'Tomorrow' : new Date(targetMs).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const monthName = new Date(targetMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'Asia/Kolkata' });

    let isBookable = true;
    let unbookableReason: string | undefined = undefined;

    if (config.isLunchEnabled === false) {
      isBookable = false;
      unbookableReason = 'Lunch service closed';
    } else if (isSunday) {
      isBookable = false;
      unbookableReason = 'Closed on Sundays';
    } else if (isToday) {
      if (todayIST.totalMinutes >= serviceEndMin) {
        isBookable = false;
        unbookableReason = `Closed for today (Ended at ${formatSingleTime(config.serviceEndTime)})`;
      } else if (todayIST.totalMinutes + prepDurationMinutes > serviceEndMin) {
        isBookable = false;
        unbookableReason = `No feasible slots remain today (${prepDurationMinutes}m prep required)`;
      }
    }

    dates.push({
      dateStr: targetIST.dateStr,
      dayName,
      displayLabel: monthName,
      fullLabel: `${dayName} (${monthName})`,
      isToday,
      isBookable,
      unbookableReason,
    });
  }

  return dates;
}

/**
 * Finds the first feasible bookable service date (Today if feasible, otherwise Tomorrow/Next open day).
 */
export function getNextFeasibleServiceDate(
  currentTimeMs = Date.now(),
  config: LunchSlotConfig = DEFAULT_LUNCH_SLOT_CONFIG,
  prepDurationMinutes = 10
): AvailableServiceDate {
  const dates = getAvailableServiceDates(currentTimeMs, config, prepDurationMinutes, 5);
  const firstBookable = dates.find(d => d.isBookable);
  return firstBookable || dates[0];
}

