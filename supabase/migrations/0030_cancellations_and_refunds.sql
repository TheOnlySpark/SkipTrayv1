-- ============================================================================
-- MIGRATION 0030: Cancellations and Refunds Management
-- Complete multi-tenant cancellation and refund workflow with separate states,
-- strike snapshot integration, strict RLS, immutable audit logs, and explicit processing.
-- ============================================================================

-- 1. Ensure order_status supports CANCELLED
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'CANCELLED';

-- 2. Create Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_status') THEN
        CREATE TYPE public.cancellation_status AS ENUM (
            'NOT_REQUESTED',
            'REQUESTED',
            'UNDER_REVIEW',
            'APPROVED',
            'REJECTED',
            'CANCELLED'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'refund_status') THEN
        CREATE TYPE public.refund_status AS ENUM (
            'NOT_REQUESTED',
            'REQUESTED',
            'UNDER_REVIEW',
            'APPROVED',
            'REJECTED',
            'PROCESSING',
            'COMPLETED',
            'FAILED',
            'CANCELLED'
        );
    END IF;
END $$;

-- 3. Create Cancellation Requests Table
CREATE TABLE IF NOT EXISTS public.cancellation_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES public.profiles(id) NOT NULL,
    tenant_id uuid REFERENCES public.tenants(id) NOT NULL,
    cancellation_reason text NOT NULL,
    strike_status_snapshot integer DEFAULT 0 NOT NULL,
    requested_refund_amount numeric(10, 2) DEFAULT 0.00 NOT NULL CHECK (requested_refund_amount >= 0),
    approved_refund_amount numeric(10, 2) DEFAULT 0.00 NOT NULL CHECK (approved_refund_amount >= 0),
    cancellation_status public.cancellation_status DEFAULT 'REQUESTED'::public.cancellation_status NOT NULL,
    refund_status public.refund_status DEFAULT 'REQUESTED'::public.refund_status NOT NULL,
    reviewed_by uuid REFERENCES public.profiles(id),
    reviewed_at timestamptz,
    review_remarks text,
    recommendation text,
    approved_by uuid REFERENCES public.profiles(id),
    approved_at timestamptz,
    processed_by uuid REFERENCES public.profiles(id),
    processed_at timestamptz,
    refund_transaction_id text,
    failure_reason text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_order_cancellation UNIQUE (order_id)
);

ALTER TABLE public.cancellation_requests ENABLE ROW LEVEL SECURITY;

-- 4. Create Audit Logs Table (Append-only & Immutable)
CREATE TABLE IF NOT EXISTS public.cancellation_audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    request_id uuid REFERENCES public.cancellation_requests(id) ON DELETE CASCADE NOT NULL,
    actor_id uuid REFERENCES public.profiles(id) NOT NULL,
    tenant_id uuid REFERENCES public.tenants(id) NOT NULL,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.cancellation_audit_logs ENABLE ROW LEVEL SECURITY;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_tenant ON public.cancellation_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_user ON public.cancellation_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_order ON public.cancellation_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_status ON public.cancellation_requests(cancellation_status, refund_status);
CREATE INDEX IF NOT EXISTS idx_cancellation_audit_logs_request ON public.cancellation_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_audit_logs_tenant ON public.cancellation_audit_logs(tenant_id);

-- 6. RLS Policies for cancellation_requests

DROP POLICY IF EXISTS "Users can insert own cancellation requests" ON public.cancellation_requests;
CREATE POLICY "Users can insert own cancellation requests" ON public.cancellation_requests 
FOR INSERT WITH CHECK (
    auth.uid() = user_id AND 
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Users can read own cancellation requests" ON public.cancellation_requests;
CREATE POLICY "Users can read own cancellation requests" ON public.cancellation_requests 
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own cancellation requests" ON public.cancellation_requests;
CREATE POLICY "Users can update own cancellation requests" ON public.cancellation_requests 
FOR UPDATE USING (
    auth.uid() = user_id AND 
    cancellation_status IN ('REQUESTED', 'UNDER_REVIEW')
);

DROP POLICY IF EXISTS "Admins/Staff can read tenant requests" ON public.cancellation_requests;
CREATE POLICY "Admins/Staff can read tenant requests" ON public.cancellation_requests 
FOR SELECT USING (
    public.get_user_role() IN ('ADMIN', 'STAFF') AND 
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Admins/Staff can update tenant requests" ON public.cancellation_requests;
CREATE POLICY "Admins/Staff can update tenant requests" ON public.cancellation_requests 
FOR UPDATE USING (
    public.get_user_role() IN ('ADMIN', 'STAFF') AND 
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Super Admins can read all requests" ON public.cancellation_requests;
CREATE POLICY "Super Admins can read all requests" ON public.cancellation_requests 
FOR SELECT USING (public.get_user_role() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS "Super Admins can update all requests" ON public.cancellation_requests;
CREATE POLICY "Super Admins can update all requests" ON public.cancellation_requests 
FOR UPDATE USING (public.get_user_role() = 'SUPER_ADMIN');

-- 7. RLS Policies for cancellation_audit_logs

DROP POLICY IF EXISTS "Users can read own audit logs" ON public.cancellation_audit_logs;
CREATE POLICY "Users can read own audit logs" ON public.cancellation_audit_logs
FOR SELECT USING (
    request_id IN (SELECT id FROM public.cancellation_requests WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins/Staff can read tenant audit logs" ON public.cancellation_audit_logs;
CREATE POLICY "Admins/Staff can read tenant audit logs" ON public.cancellation_audit_logs
FOR SELECT USING (
    public.get_user_role() IN ('ADMIN', 'STAFF') AND
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Super Admins can read all audit logs" ON public.cancellation_audit_logs;
CREATE POLICY "Super Admins can read all audit logs" ON public.cancellation_audit_logs
FOR SELECT USING (public.get_user_role() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.cancellation_audit_logs;
CREATE POLICY "Authenticated users can insert audit logs" ON public.cancellation_audit_logs
FOR INSERT WITH CHECK (auth.uid() = actor_id);

-- Enforce append-only immutability
DROP POLICY IF EXISTS "No updates on audit logs" ON public.cancellation_audit_logs;
CREATE POLICY "No updates on audit logs" ON public.cancellation_audit_logs FOR UPDATE USING (false);

DROP POLICY IF EXISTS "No deletes on audit logs" ON public.cancellation_audit_logs;
CREATE POLICY "No deletes on audit logs" ON public.cancellation_audit_logs FOR DELETE USING (false);
