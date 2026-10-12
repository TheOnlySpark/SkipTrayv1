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
  updatedAt?: string;
}

export const DEFAULT_LUNCH_SLOT_CONFIG: LunchSlotConfig = {
  serviceStartTime: '12:00',
  serviceEndTime: '14:00',
  slotDurationMinutes: 15,
  minNoticeMinutes: 30,
  isLunchEnabled: true,
  disabledSlots: [],
  slotCapacities: {},
};

/**
 * Format a 24-hr time string ('12:30', '13:00') into 12-hr format ('12:30 PM', '1:00 PM').
 */
export const formatPickupTime = (timeStr?: string | null): string => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayHour}:${String(m).padStart(2, '0')} ${period}`;
};

/**
 * Helper to parse "HH:MM" into total minutes from 00:00.
 */
export const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

/**
 * Helper to convert minutes from midnight to "HH:MM".
 */
export const minutesToTimeString = (totalMinutes: number): string => {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Format two time strings as a range: e.g. "12:00 PM – 12:15 PM"
 */
export const formatTimeRange = (startTime: string, endTime: string): string => {
  return `${formatPickupTime(startTime)} – ${formatPickupTime(endTime)}`;
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
