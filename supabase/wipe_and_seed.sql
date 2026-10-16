-- ============================================================================
-- SCRIPT: System Initialization & Safe Seed (Sanitized — No Hardcoded Accounts)
-- ============================================================================
-- SECURITY NOTICE:
-- Hardcoded administrator accounts, passwords, and destructive table wipes
-- have been permanently removed from this script (remediation of MEDIUM-02).
--
-- To provision a Super Admin account securely:
-- Run the server-side provisioning CLI:
--   npm run provision:super-admin -- --email admin@yourdomain.com
--
-- This script only ensures the non-sensitive System Tenant exists for initial setup.
-- ============================================================================

-- 1. Ensure the System Tenant exists (Required for Super Admins)
INSERT INTO public.tenants (id, slug, name, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system',
    'System Administration',
    true
)
ON CONFLICT (id) DO UPDATE
SET name = 'System Administration', is_active = true;

-- 2. Ensure System Tenant Settings exist
INSERT INTO public.tenant_settings (tenant_id, display_name)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'System Administration'
)
ON CONFLICT (tenant_id) DO UPDATE
SET display_name = 'System Administration';

-- End of safe seed script.
-- DO NOT insert user credentials, passwords, or authentication secrets into SQL files.
