-- 0039_smart_prep_scheduling.sql
-- Smart Preparation Scheduling and Flexible User-Selected Lunch Pickup Time

-- 1. Add preparation and scheduling columns to orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS requested_pickup_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS estimated_prep_duration_minutes INTEGER DEFAULT 12,
ADD COLUMN IF NOT EXISTS planned_prep_start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS target_ready_by_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS preparation_started_at TIMESTAMPTZ;

-- 2. Add preparation time to menu items
ALTER TABLE public.menu_items
ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER DEFAULT 10;

-- 3. Add kitchen capacity and scheduling configuration to lunch_slot_configs
ALTER TABLE public.lunch_slot_configs
ADD COLUMN IF NOT EXISTS max_concurrent_orders INTEGER DEFAULT 15,
ADD COLUMN IF NOT EXISTS default_prep_time_minutes INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS order_cutoff_minutes INTEGER DEFAULT 15;

-- 4. Function to backfill existing orders with estimated preparation schedule if missing
DO $$
BEGIN
  -- Backfill planned_prep_start_time and target_ready_by_time based on pickup_time text and created_at
  UPDATE public.orders
  SET 
    estimated_prep_duration_minutes = COALESCE(estimated_prep_duration_minutes, 12),
    target_ready_by_time = COALESCE(
      target_ready_by_time,
      CASE 
        WHEN pickup_time ~ '^\d{2}:\d{2}' THEN 
          (created_at::date + (SUBSTRING(pickup_time FROM '^\d{2}:\d{2}')::time))::timestamptz
        ELSE created_at + interval '30 minutes'
      END
    ),
    planned_prep_start_time = COALESCE(
      planned_prep_start_time,
      CASE 
        WHEN pickup_time ~ '^\d{2}:\d{2}' THEN 
          (created_at::date + (SUBSTRING(pickup_time FROM '^\d{2}:\d{2}')::time) - interval '12 minutes')::timestamptz
        ELSE created_at + interval '18 minutes'
      END
    ),
    requested_pickup_time = COALESCE(
      requested_pickup_time,
      CASE 
        WHEN pickup_time ~ '^\d{2}:\d{2}' THEN 
          (created_at::date + (SUBSTRING(pickup_time FROM '^\d{2}:\d{2}')::time))::timestamptz
        ELSE created_at + interval '30 minutes'
      END
    )
  WHERE requested_pickup_time IS NULL;
END $$;

-- 5. RPC function to calculate smart preparation schedule & validate capacity
CREATE OR REPLACE FUNCTION public.calculate_order_schedule(
  p_canteen_id UUID,
  p_pickup_time_str TEXT, -- e.g. "12:17" or "12:17 PM" or ISO string
  p_items JSONB,          -- array of {"id": "uuid", "quantity": 1}
  p_order_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot_config RECORD;
  v_service_start_time TIME;
  v_service_end_time TIME;
  v_min_notice_minutes INT := 30;
  v_max_capacity INT := 15;
  v_default_prep_minutes INT := 10;
  
  v_clean_time_str TEXT;
  v_pickup_time TIME;
  v_requested_ts TIMESTAMPTZ;
  
  v_max_item_prep INT := 0;
  v_additional_items_count INT := 0;
  v_estimated_prep_duration INT := 10;
  v_planned_prep_start_ts TIMESTAMPTZ;
  v_target_ready_ts TIMESTAMPTZ;
  
  v_now TIMESTAMPTZ := timezone('Asia/Kolkata', now());
  v_current_workload INT := 0;
  
  v_suggested_pickup_time TIME;
  v_item RECORD;
  v_item_prep INT;
BEGIN
  -- 1. Fetch canteen configuration
  SELECT * INTO v_slot_config
  FROM public.lunch_slot_configs
  WHERE canteen_id = p_canteen_id
  LIMIT 1;

  IF FOUND THEN
    v_service_start_time := (COALESCE(v_slot_config.service_start_time, '12:00'))::time;
    v_service_end_time   := (COALESCE(v_slot_config.service_end_time, '14:00'))::time;
    v_min_notice_minutes := COALESCE(v_slot_config.min_notice_minutes, 30);
    v_max_capacity       := COALESCE(v_slot_config.max_concurrent_orders, 15);
    v_default_prep_minutes := COALESCE(v_slot_config.default_prep_time_minutes, 10);
    
    IF v_slot_config.is_lunch_enabled IS FALSE THEN
      RETURN jsonb_build_object(
        'is_available', false,
        'error', 'Lunch ordering is currently closed for this canteen.'
      );
    END IF;
  ELSE
    v_service_start_time := '12:00'::time;
    v_service_end_time   := '14:00'::time;
  END IF;

  -- 2. Parse pickup time string
  v_clean_time_str := TRIM(p_pickup_time_str);
  -- Extract HH:MM
  IF v_clean_time_str ~ '^\d{2}:\d{2}' THEN
    v_pickup_time := (SUBSTRING(v_clean_time_str FROM '^\d{2}:\d{2}'))::time;
  ELSIF v_clean_time_str ~ 'T\d{2}:\d{2}' THEN
    v_pickup_time := (SUBSTRING(v_clean_time_str FROM 'T(\d{2}:\d{2})'))::time;
  ELSE
    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Invalid pickup time format. Expected HH:MM.'
    );
  END IF;

  -- Construct timezone-aware timestamp for pickup in IST
  v_requested_ts := (p_order_date + v_pickup_time) AT TIME ZONE 'Asia/Kolkata';

  -- 3. Calculate estimated preparation duration based on items in cart
  -- Items prepare concurrently in kitchen: max item prep time + 1 min per additional item
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id UUID, quantity INT)
    LOOP
      SELECT COALESCE(prep_time_minutes, v_default_prep_minutes)
      INTO v_item_prep
      FROM public.menu_items
      WHERE id = v_item.id;

      IF v_item_prep IS NULL THEN
        v_item_prep := v_default_prep_minutes;
      END IF;

      IF v_item_prep > v_max_item_prep THEN
        v_max_item_prep := v_item_prep;
      END IF;

      v_additional_items_count := v_additional_items_count + COALESCE(v_item.quantity, 1);
    END LOOP;

    -- Concurrency formula: Max item duration + 1 min per extra item beyond the primary item (capped at 35 mins)
    v_estimated_prep_duration := LEAST(35, GREATEST(8, v_max_item_prep + GREATEST(0, v_additional_items_count - 1)));
  ELSE
    v_estimated_prep_duration := v_default_prep_minutes;
  END IF;

  -- 4. Calculate planned preparation start time and target ready-by time
  v_planned_prep_start_ts := v_requested_ts - (v_estimated_prep_duration || ' minutes')::interval;
  v_target_ready_ts := v_requested_ts;

  -- 5. Validate against service operating hours
  IF v_pickup_time < v_service_start_time THEN
    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Requested pickup time is before lunch service opens at ' || to_char(v_service_start_time, 'HH12:MI AM') || '.',
      'suggested_pickup_time', to_char(v_service_start_time, 'HH24:MI')
    );
  END IF;

  IF v_pickup_time > v_service_end_time THEN
    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Requested pickup time is after lunch service closes at ' || to_char(v_service_end_time, 'HH12:MI AM') || '.',
      'suggested_pickup_time', to_char(v_service_end_time, 'HH24:MI')
    );
  END IF;

  -- 6. Validate that preparation start time is not in the past
  IF v_planned_prep_start_ts < v_now THEN
    -- Calculate earliest feasible pickup time based on current time + prep duration + 2 min buffer
    v_suggested_pickup_time := (v_now + ((v_estimated_prep_duration + 2) || ' minutes')::interval)::time;
    
    -- Round up to nearest whole minute
    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Kitchen requires ' || v_estimated_prep_duration || ' minutes to prepare this order. Earliest pickup time is ' || to_char(v_suggested_pickup_time, 'HH12:MI AM') || '.',
      'suggested_pickup_time', to_char(v_suggested_pickup_time, 'HH24:MI'),
      'suggested_pickup_formatted', to_char(v_suggested_pickup_time, 'HH12:MI AM'),
      'estimated_prep_duration_minutes', v_estimated_prep_duration
    );
  END IF;

  -- 7. Kitchen Capacity Check: count active orders with overlapping prep windows (+/- 15 mins)
  SELECT COUNT(*) INTO v_current_workload
  FROM public.orders o
  WHERE o.canteen_id = p_canteen_id
    AND o.status IN ('PLACED', 'ACCEPTED', 'PREPARING')
    AND o.created_at::date = p_order_date
    AND (
      (o.planned_prep_start_time IS NOT NULL AND 
       o.planned_prep_start_time BETWEEN v_planned_prep_start_ts - interval '10 minutes' AND v_planned_prep_start_ts + interval '10 minutes')
      OR
      (o.pickup_time ~ '^\d{2}:\d{2}' AND 
       (p_order_date + (SUBSTRING(o.pickup_time FROM '^\d{2}:\d{2}'))::time) BETWEEN (p_order_date + v_pickup_time) - interval '10 minutes' AND (p_order_date + v_pickup_time) + interval '10 minutes')
    );

  IF v_current_workload >= v_max_capacity THEN
    v_suggested_pickup_time := (v_pickup_time + interval '15 minutes')::time;
    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Kitchen preparation capacity (' || v_max_capacity || ' orders) is currently full around ' || to_char(v_pickup_time, 'HH12:MI AM') || '. Please select ' || to_char(v_suggested_pickup_time, 'HH12:MI AM') || ' or another slot.',
      'suggested_pickup_time', to_char(v_suggested_pickup_time, 'HH24:MI'),
      'suggested_pickup_formatted', to_char(v_suggested_pickup_time, 'HH12:MI AM'),
      'current_workload', v_current_workload,
      'max_capacity', v_max_capacity
    );
  END IF;

  -- 8. Return successful scheduling payload
  RETURN jsonb_build_object(
    'is_available', true,
    'requested_pickup_time', v_requested_ts,
    'pickup_time_str', to_char(v_pickup_time, 'HH24:MI'),
    'pickup_time_formatted', to_char(v_pickup_time, 'HH12:MI AM'),
    'estimated_prep_duration_minutes', v_estimated_prep_duration,
    'planned_prep_start_time', v_planned_prep_start_ts,
    'prep_start_formatted', to_char(v_planned_prep_start_ts AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
    'target_ready_by_time', v_target_ready_ts,
    'ready_by_formatted', to_char(v_target_ready_ts AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
    'current_workload_count', v_current_workload,
    'max_capacity', v_max_capacity
  );
END;
$$;
