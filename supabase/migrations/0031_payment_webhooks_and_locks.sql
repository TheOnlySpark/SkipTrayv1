-- ============================================================================
-- MIGRATION 0031: Payment Webhook Logs & Distributed Locks
-- Comprehensive webhook logging, atomic distributed locking with fencing tokens,
-- idempotency enforcement, and tenant-isolated audit trail.
-- ============================================================================

-- 1. Create Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_processing_status') THEN
        CREATE TYPE public.webhook_processing_status AS ENUM (
            'RECEIVED',
            'PROCESSING',
            'PROCESSED',
            'FAILED',
            'RETRY_PENDING',
            'DUPLICATE_EVENT'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_signature_status') THEN
        CREATE TYPE public.webhook_signature_status AS ENUM (
            'VERIFIED',
            'INVALID_SIGNATURE',
            'SKIPPED'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lock_status') THEN
        CREATE TYPE public.lock_status AS ENUM (
            'UNLOCKED',
            'LOCKED',
            'LOCK_EXPIRED'
        );
    END IF;
END $$;

-- 2. Create Payment Locks Table
CREATE TABLE IF NOT EXISTS public.payment_locks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    resource_type text NOT NULL,                    -- e.g. 'PAYMENT', 'ORDER', 'WEBHOOK_EVENT'
    resource_id text NOT NULL,                      -- e.g. payment_id or order_id
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
    lock_owner text NOT NULL,                       -- e.g. 'worker-prod-1', 'admin-manual'
    lock_token uuid DEFAULT gen_random_uuid() NOT NULL, -- Fencing token for zombie worker protection
    lock_status public.lock_status DEFAULT 'LOCKED'::public.lock_status NOT NULL,
    acquired_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at timestamptz NOT NULL,                -- Lease timeout
    released_at timestamptz,
    release_reason text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_resource_lock UNIQUE (resource_type, resource_id)
);

ALTER TABLE public.payment_locks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_locks_resource ON public.payment_locks(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_payment_locks_status ON public.payment_locks(lock_status, expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_locks_tenant ON public.payment_locks(tenant_id);

-- 3. Create Payment Webhook Events Table
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    provider_event_id text NOT NULL,               -- Authoritative gateway event ID
    provider text NOT NULL,                        -- e.g. 'ZohoPay', 'Cashfree', 'Razorpay'
    event_type text NOT NULL,                      -- e.g. 'payment.captured', 'payment.failed'
    payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
    booking_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    university_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
    amount numeric(10, 2) DEFAULT 0.00 NOT NULL CHECK (amount >= 0),
    currency text DEFAULT 'INR' NOT NULL,
    signature_status public.webhook_signature_status DEFAULT 'VERIFIED'::public.webhook_signature_status NOT NULL,
    processing_status public.webhook_processing_status DEFAULT 'RECEIVED'::public.webhook_processing_status NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    lock_id uuid REFERENCES public.payment_locks(id) ON DELETE SET NULL,
    lock_status public.lock_status DEFAULT 'UNLOCKED'::public.lock_status NOT NULL,
    lock_owner text,
    lock_acquired_at timestamptz,
    lock_expires_at timestamptz,
    last_error text,
    last_attempt_at timestamptz,
    processed_at timestamptz,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_provider_event UNIQUE (provider, provider_event_id)
);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant ON public.payment_webhook_events(university_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_payment ON public.payment_webhook_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_booking ON public.payment_webhook_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON public.payment_webhook_events(processing_status, signature_status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON public.payment_webhook_events(created_at DESC);

-- 4. Create Webhook Audit Logs Table (Append-only & Immutable)
CREATE TABLE IF NOT EXISTS public.payment_webhook_audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    webhook_event_id uuid REFERENCES public.payment_webhook_events(id) ON DELETE CASCADE,
    payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
    actor_id uuid REFERENCES public.profiles(id),
    actor_type text NOT NULL,                       -- 'SYSTEM', 'WORKER', 'ADMIN', 'SUPER_ADMIN'
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.payment_webhook_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_webhook_audit_event ON public.payment_webhook_audit_logs(webhook_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_audit_payment ON public.payment_webhook_audit_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_audit_tenant ON public.payment_webhook_audit_logs(tenant_id);

-- 5. Atomic Lock Management Functions (RPC)

-- A. Acquire Lock Function
CREATE OR REPLACE FUNCTION public.acquire_payment_lock(
    p_resource_type text,
    p_resource_id text,
    p_tenant_id uuid,
    p_lock_owner text,
    p_ttl_seconds integer DEFAULT 60
) RETURNS jsonb AS $$
DECLARE
    v_now timestamptz := timezone('utc'::text, now());
    v_expires timestamptz := v_now + (p_ttl_seconds || ' seconds')::interval;
    v_lock public.payment_locks%ROWTYPE;
    v_new_token uuid := gen_random_uuid();
BEGIN
    -- Check if active lock exists
    SELECT * INTO v_lock
    FROM public.payment_locks
    WHERE resource_type = p_resource_type AND resource_id = p_resource_id
    FOR UPDATE;

    IF v_lock.id IS NULL THEN
        -- Insert new lock
        INSERT INTO public.payment_locks (
            resource_type, resource_id, tenant_id, lock_owner,
            lock_token, lock_status, acquired_at, expires_at
        ) VALUES (
            p_resource_type, p_resource_id, p_tenant_id, p_lock_owner,
            v_new_token, 'LOCKED'::public.lock_status, v_now, v_expires
        ) RETURNING * INTO v_lock;

        RETURN jsonb_build_object(
            'success', true,
            'lock_id', v_lock.id,
            'lock_token', v_lock.lock_token,
            'expires_at', v_lock.expires_at,
            'message', 'Lock acquired successfully'
        );
    END IF;

    -- If lock is currently active and unexpired
    IF v_lock.lock_status = 'LOCKED'::public.lock_status AND v_lock.expires_at > v_now THEN
        RETURN jsonb_build_object(
            'success', false,
            'lock_id', v_lock.id,
            'current_owner', v_lock.lock_owner,
            'expires_at', v_lock.expires_at,
            'message', 'Resource is currently locked by ' || v_lock.lock_owner
        );
    END IF;

    -- If expired or unlocked, take over lock atomically with new fencing token
    UPDATE public.payment_locks
    SET lock_owner = p_lock_owner,
        lock_token = v_new_token,
        lock_status = 'LOCKED'::public.lock_status,
        acquired_at = v_now,
        expires_at = v_expires,
        released_at = NULL,
        release_reason = NULL,
        updated_at = v_now
    WHERE id = v_lock.id
    RETURNING * INTO v_lock;

    RETURN jsonb_build_object(
        'success', true,
        'lock_id', v_lock.id,
        'lock_token', v_lock.lock_token,
        'expires_at', v_lock.expires_at,
        'message', 'Lock acquired successfully after lease expiration/release'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- B. Release Lock Function (Fencing Protected)
CREATE OR REPLACE FUNCTION public.release_payment_lock(
    p_lock_id uuid,
    p_lock_token uuid,
    p_release_reason text DEFAULT 'Processing completed'
) RETURNS jsonb AS $$
DECLARE
    v_now timestamptz := timezone('utc'::text, now());
    v_lock public.payment_locks%ROWTYPE;
BEGIN
    SELECT * INTO v_lock FROM public.payment_locks WHERE id = p_lock_id FOR UPDATE;

    IF v_lock.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lock not found');
    END IF;

    -- Protect against zombie worker by checking fencing token
    IF v_lock.lock_token != p_lock_token THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Invalid lock token (lock was already reassigned or expired)'
        );
    END IF;

    UPDATE public.payment_locks
    SET lock_status = 'UNLOCKED'::public.lock_status,
        released_at = v_now,
        release_reason = p_release_reason,
        updated_at = v_now
    WHERE id = p_lock_id;

    RETURN jsonb_build_object('success', true, 'message', 'Lock released successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- C. Admin Release Expired Lock Function
CREATE OR REPLACE FUNCTION public.release_expired_lock_admin(
    p_lock_id uuid,
    p_admin_id uuid,
    p_reason text DEFAULT 'Manual administrator recovery'
) RETURNS jsonb AS $$
DECLARE
    v_now timestamptz := timezone('utc'::text, now());
    v_lock public.payment_locks%ROWTYPE;
    v_role public.user_role;
    v_admin_tenant uuid;
BEGIN
    -- Verify admin role
    SELECT role, tenant_id INTO v_role, v_admin_tenant
    FROM public.profiles WHERE id = p_admin_id;

    IF v_role NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
        RAISE EXCEPTION 'Unauthorized: only administrators can release expired locks';
    END IF;

    SELECT * INTO v_lock FROM public.payment_locks WHERE id = p_lock_id FOR UPDATE;

    IF v_lock.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lock record not found');
    END IF;

    -- Check tenant isolation if not super admin
    IF v_role != 'SUPER_ADMIN' AND v_lock.tenant_id != v_admin_tenant THEN
        RAISE EXCEPTION 'Unauthorized: cannot modify locks belonging to another university';
    END IF;

    -- Only allow release if lease has genuinely expired
    IF v_lock.lock_status = 'LOCKED' AND v_lock.expires_at > v_now THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Cannot release active unexpired lock. Wait until lease expiration time (' || v_lock.expires_at || ')'
        );
    END IF;

    UPDATE public.payment_locks
    SET lock_status = 'LOCK_EXPIRED'::public.lock_status,
        released_at = v_now,
        release_reason = COALESCE(p_reason, 'Released by administrator'),
        updated_at = v_now
    WHERE id = p_lock_id;

    -- Update linked webhook event if any
    UPDATE public.payment_webhook_events
    SET lock_status = 'LOCK_EXPIRED'::public.lock_status
    WHERE lock_id = p_lock_id;

    -- Audit log
    INSERT INTO public.payment_webhook_audit_logs (
        actor_id, actor_type, tenant_id, action, details
    ) VALUES (
        p_admin_id,
        CASE WHEN v_role = 'SUPER_ADMIN' THEN 'SUPER_ADMIN' ELSE 'ADMIN' END,
        v_lock.tenant_id,
        'LOCK_RELEASED_MANUAL',
        jsonb_build_object('lock_id', p_lock_id, 'reason', p_reason, 'released_at', v_now)
    );

    RETURN jsonb_build_object('success', true, 'message', 'Expired lock released successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Row Level Security (RLS) Policies

-- A. payment_locks RLS
DROP POLICY IF EXISTS "Admins can view tenant locks" ON public.payment_locks;
CREATE POLICY "Admins can view tenant locks" ON public.payment_locks
FOR SELECT USING (
    public.get_user_role() IN ('ADMIN', 'STAFF') AND
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Super Admins can view all locks" ON public.payment_locks;
CREATE POLICY "Super Admins can view all locks" ON public.payment_locks
FOR SELECT USING (public.get_user_role() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS "Super Admins can modify all locks" ON public.payment_locks;
CREATE POLICY "Super Admins can modify all locks" ON public.payment_locks
FOR ALL USING (public.get_user_role() = 'SUPER_ADMIN');

-- B. payment_webhook_events RLS
DROP POLICY IF EXISTS "Admins can view tenant webhook events" ON public.payment_webhook_events;
CREATE POLICY "Admins can view tenant webhook events" ON public.payment_webhook_events
FOR SELECT USING (
    public.get_user_role() IN ('ADMIN', 'STAFF') AND
    university_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Super Admins can view all webhook events" ON public.payment_webhook_events;
CREATE POLICY "Super Admins can view all webhook events" ON public.payment_webhook_events
FOR SELECT USING (public.get_user_role() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS "Super Admins can update all webhook events" ON public.payment_webhook_events;
CREATE POLICY "Super Admins can update all webhook events" ON public.payment_webhook_events
FOR UPDATE USING (public.get_user_role() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS "Admins can update tenant webhook events" ON public.payment_webhook_events;
CREATE POLICY "Admins can update tenant webhook events" ON public.payment_webhook_events
FOR UPDATE USING (
    public.get_user_role() IN ('ADMIN', 'STAFF') AND
    university_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

-- C. payment_webhook_audit_logs RLS
DROP POLICY IF EXISTS "Admins can view tenant webhook audit logs" ON public.payment_webhook_audit_logs;
CREATE POLICY "Admins can view tenant webhook audit logs" ON public.payment_webhook_audit_logs
FOR SELECT USING (
    public.get_user_role() IN ('ADMIN', 'STAFF') AND
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Super Admins can view all webhook audit logs" ON public.payment_webhook_audit_logs;
CREATE POLICY "Super Admins can view all webhook audit logs" ON public.payment_webhook_audit_logs
FOR SELECT USING (public.get_user_role() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS "Authenticated can insert webhook audit logs" ON public.payment_webhook_audit_logs;
CREATE POLICY "Authenticated can insert webhook audit logs" ON public.payment_webhook_audit_logs
FOR INSERT WITH CHECK (auth.uid() = actor_id OR actor_id IS NULL);

-- Strict Immutability on Audit Logs
DROP POLICY IF EXISTS "No updates on webhook audit logs" ON public.payment_webhook_audit_logs;
CREATE POLICY "No updates on webhook audit logs" ON public.payment_webhook_audit_logs FOR UPDATE USING (false);

DROP POLICY IF EXISTS "No deletes on webhook audit logs" ON public.payment_webhook_audit_logs;
CREATE POLICY "No deletes on webhook audit logs" ON public.payment_webhook_audit_logs FOR DELETE USING (false);
