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

export interface LunchSlotConfig {
  id?: string;
  canteenId?: string | null;
  tenantId?: string | null;
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
  serviceStartTime: '12:00',
  serviceEndTime: '14:00',
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
  if (trimmed.includes('T')) {
    trimmed = trimmed.split('T')[1].trim();
  }
  trimmed = trimmed.replace(/([+-]\d{2}:\d{2}|Z)$/, '').trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
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
 * Respects duration (5, 10, 15, 20, 30 min) and strictly caps within service end time.
 */
export const generateSlotsFromConfig = (config: LunchSlotConfig): LunchSlot[] => {
  const startMin = parseTimeToMinutes(config.serviceStartTime || '12:00');
  const endMin = parseTimeToMinutes(config.serviceEndTime || '14:00');
  const duration = Number(config.slotDurationMinutes) || 15;

  if (startMin >= endMin || duration <= 0) {
    return [];
  }

  const slots: LunchSlot[] = [];
  const disabledSet = new Set(config.disabledSlots || []);

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

  // 1. Check local cache
  let cachedConfig: LunchSlotConfig | null = null;
  try {
    const local = localStorage.getItem(cacheKey);
    if (local) {
      cachedConfig = JSON.parse(local);
    }
  } catch (e) {
    // Ignore cache parse error
  }

  // 2. Fetch from Supabase
  try {
    let query = supabase.from('lunch_slot_configs').select('*');
    if (canteenId) {
      query = query.eq('canteen_id', canteenId);
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!error && data) {
      const parsedConfig: LunchSlotConfig = {
        id: data.id,
        canteenId: data.canteen_id,
        tenantId: data.tenant_id,
        serviceStartTime: data.service_start_time || '12:00',
        serviceEndTime: data.service_end_time || '14:00',
        slotDurationMinutes: Number(data.slot_duration_minutes) || 15,
        minNoticeMinutes: Number(data.min_notice_minutes) || 30,
        isLunchEnabled: data.is_lunch_enabled ?? true,
        disabledSlots: Array.isArray(data.disabled_slots) ? (data.disabled_slots as string[]) : [],
        slotCapacities: typeof data.slot_capacities === 'object' && data.slot_capacities !== null ? (data.slot_capacities as Record<string, number>) : {},
        maxConcurrentOrders: Number(data.max_concurrent_orders) || 15,
        defaultPrepTimeMinutes: Number(data.default_prep_time_minutes) || 10,
        orderCutoffMinutes: Number(data.order_cutoff_minutes) || 15,
        updatedAt: data.updated_at,
      };

      try {
        localStorage.setItem(cacheKey, JSON.stringify(parsedConfig));
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
    canteenId: canteenId || config.canteenId || null,
    tenantId: tenantId || config.tenantId || null,
    updatedAt: new Date().toISOString(),
  };

  // 1. Immediately update local storage so user sees changes instantly
  try {
    localStorage.setItem(cacheKey, JSON.stringify(updatedConfig));
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
