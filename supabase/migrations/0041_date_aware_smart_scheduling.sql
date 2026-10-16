-- 0041_date_aware_smart_scheduling.sql
-- Date-aware pickup scheduling and accurate feasible-time calculations

CREATE OR REPLACE FUNCTION public.calculate_order_schedule(
  p_canteen_id UUID,
  p_pickup_time_str TEXT, -- e.g. "12:17" or "12:17 PM" or ISO string
  p_items JSONB,          -- array of {"id": "uuid", "quantity": 1}
  p_order_date DATE DEFAULT (timezone('Asia/Kolkata', now()))::date
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
  v_today DATE := v_now::date;
  v_now_time TIME := v_now::time;
  v_current_workload INT := 0;
  
  v_suggested_pickup_time TIME;
  v_next_date DATE;
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

  -- 2. Validate Service Date: Check for Sundays and past dates
  IF EXTRACT(DOW FROM p_order_date) = 0 THEN
    -- Sunday: find next open date (Monday)
    v_next_date := p_order_date + 1;
    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Canteen is closed on Sundays. Please select a weekday or Saturday.',
      'suggested_pickup_time', to_char(v_service_start_time, 'HH24:MI'),
      'suggested_date', to_char(v_next_date, 'YYYY-MM-DD')
    );
  END IF;

  IF p_order_date < v_today THEN
    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Selected service date has already passed. Please choose an upcoming service date.'
    );
  END IF;

  -- 3. Parse pickup time string
  v_clean_time_str := TRIM(p_pickup_time_str);
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

  -- 4. Calculate estimated preparation duration based on items in cart
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

  -- 5. Calculate planned preparation start time and target ready-by time
  v_planned_prep_start_ts := v_requested_ts - (v_estimated_prep_duration || ' minutes')::interval;
  v_target_ready_ts := v_requested_ts;

  -- Calculate next bookable date (Tomorrow or Monday if tomorrow is Sunday)
  v_next_date := p_order_date + 1;
  IF EXTRACT(DOW FROM v_next_date) = 0 THEN
    v_next_date := v_next_date + 1;
  END IF;

  -- 6. Check if service hours have already ended or cannot accommodate prep today
  IF p_order_date = v_today THEN
    IF v_now_time >= v_service_end_time OR (v_now_time + (v_estimated_prep_duration || ' minutes')::interval) > v_service_end_time THEN
      RETURN jsonb_build_object(
        'is_available', false,
        'error', 'Lunch service has closed for today (' || to_char(v_service_end_time, 'HH12:MI AM') || '). Please select the next available service date.',
        'suggested_pickup_time', to_char(v_service_start_time, 'HH24:MI'),
        'suggested_pickup_formatted', to_char(v_service_start_time, 'HH12:MI AM'),
        'suggested_date', to_char(v_next_date, 'YYYY-MM-DD'),
        'suggested_date_formatted', to_char(v_next_date, 'Dy, DD Mon')
      );
    END IF;
  END IF;

  -- 7. Validate against service operating hours (12:00 PM – 2:00 PM)
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

  -- 8. Validate that preparation start time is not in the past (same-day orders)
  IF p_order_date = v_today AND v_planned_prep_start_ts < v_now THEN
    v_suggested_pickup_time := (v_now + ((v_estimated_prep_duration + 2) || ' minutes')::interval)::time;
    
    IF v_suggested_pickup_time > v_service_end_time THEN
      -- No feasible time remains today, suggest next service date
      RETURN jsonb_build_object(
        'is_available', false,
        'error', 'No feasible pickup times remain today. Please choose the next available service date.',
        'suggested_pickup_time', to_char(v_service_start_time, 'HH24:MI'),
        'suggested_pickup_formatted', to_char(v_service_start_time, 'HH12:MI AM'),
        'suggested_date', to_char(v_next_date, 'YYYY-MM-DD'),
        'suggested_date_formatted', to_char(v_next_date, 'Dy, DD Mon')
      );
    END IF;

    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Kitchen requires ' || v_estimated_prep_duration || ' minutes to prepare this order. Earliest pickup time is ' || to_char(v_suggested_pickup_time, 'HH12:MI AM') || '.',
      'suggested_pickup_time', to_char(v_suggested_pickup_time, 'HH24:MI'),
      'suggested_pickup_formatted', to_char(v_suggested_pickup_time, 'HH12:MI AM'),
      'estimated_prep_duration_minutes', v_estimated_prep_duration
    );
  END IF;

  -- 9. Kitchen Capacity Check: count active orders with overlapping prep windows (+/- 10 mins)
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
    IF v_suggested_pickup_time > v_service_end_time THEN
      RETURN jsonb_build_object(
        'is_available', false,
        'error', 'Kitchen preparation capacity (' || v_max_capacity || ' orders) is currently full for the rest of today. Please select another service date.',
        'suggested_pickup_time', to_char(v_service_start_time, 'HH24:MI'),
        'suggested_date', to_char(v_next_date, 'YYYY-MM-DD')
      );
    END IF;

    RETURN jsonb_build_object(
      'is_available', false,
      'error', 'Kitchen preparation capacity (' || v_max_capacity || ' orders) is currently full around ' || to_char(v_pickup_time, 'HH12:MI AM') || '. Please select ' || to_char(v_suggested_pickup_time, 'HH12:MI AM') || ' or another slot.',
      'suggested_pickup_time', to_char(v_suggested_pickup_time, 'HH24:MI'),
      'suggested_pickup_formatted', to_char(v_suggested_pickup_time, 'HH12:MI AM'),
      'current_workload', v_current_workload,
      'max_capacity', v_max_capacity
    );
  END IF;

  -- 10. Return successful scheduling payload
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
