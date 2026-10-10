-- ============================================================================
-- MIGRATION 0032: Upgrade Legacy Admins
-- Upgrades all users with the legacy 'ADMIN' role to 'UNI_ADMIN'.
-- ============================================================================

UPDATE public.profiles
SET role = 'UNI_ADMIN'
WHERE role = 'ADMIN';

-- Since 'ADMIN' is no longer used, we ensure any stragglers are migrated.
