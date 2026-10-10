-- ============================================================================
-- SCRIPT: Wipe Data & Seed Super Admin
-- INSTRUCTIONS: Run this directly in your Supabase SQL Editor.
-- ============================================================================

-- 1. Wipe all data (Cascade will handle related records)
TRUNCATE TABLE public.order_items CASCADE;
TRUNCATE TABLE public.orders CASCADE;
TRUNCATE TABLE public.menu_items CASCADE;
TRUNCATE TABLE public.item_reviews CASCADE;
TRUNCATE TABLE public.payments CASCADE;
TRUNCATE TABLE public.tenant_settings CASCADE;
TRUNCATE TABLE public.canteens CASCADE;
TRUNCATE TABLE public.profiles CASCADE;
TRUNCATE TABLE public.tenants CASCADE;

-- Clear auth.users to reset all authentication
DELETE FROM auth.users;

-- 2. Re-create the System Tenant (Required for Super Admin)
INSERT INTO public.tenants (id, slug, name, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'system', 'System Administration', true);

INSERT INTO public.tenant_settings (tenant_id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'System Administration');

-- 3. Seed Super Admin User (password: password123)
-- (We MUST include instance_id so it shows up in the Supabase Dashboard!)
INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'superadmin@skiptray.com',
    crypt('password123', gen_salt('bf')),
    current_timestamp,
    current_timestamp,
    current_timestamp,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"tenant_id": "00000000-0000-0000-0000-000000000001"}'::jsonb,
    current_timestamp,
    current_timestamp,
    '',
    '',
    '',
    ''
);

-- 4. Create the required auth.identities record so Supabase allows email/password login
INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  format('{"sub":"11111111-1111-1111-1111-111111111111","email":"%s"}', 'superadmin@skiptray.com')::jsonb,
  'email',
  '11111111-1111-1111-1111-111111111111',
  current_timestamp,
  current_timestamp,
  current_timestamp
);

-- 5. Update the auto-generated profile to be SUPER_ADMIN
UPDATE public.profiles
SET role = 'SUPER_ADMIN', name = 'Super Administrator'
WHERE id = '11111111-1111-1111-1111-111111111111';
