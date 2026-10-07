import React, { createContext, useContext, useEffect, useState } from 'react';

export interface TenantSettings {
  display_name: string;
  logo_url: string | null;
  primary_color: string;
  timezone: string;
}

interface TenantContextType {
  tenantId: string | null;
  tenantSlug: string;
  tenantName: string;
  settings: TenantSettings | null;
  isActive: boolean;
  loading: boolean;
  error: 'NOT_FOUND' | 'INACTIVE' | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

/**
 * Extracts the subdomain slug from the current hostname.
 * - "acme.skiptray.com"  → "acme"
 * - "acme.localhost"     → "acme"
 * - "localhost" / "skiptray.com" → "default"
 */
function extractSlug(hostname: string): string {
  // Strip port if present
  const host = hostname.split(':')[0];
  const parts = host.split('.');

  // acme.localhost → ["acme", "localhost"] → slug = "acme"
  // acme.skiptray.com → ["acme", "skiptray", "com"] → slug = "acme"
  // localhost → ["localhost"] → default
  // skiptray.com → ["skiptray", "com"] → default
  if (parts.length >= 2 && parts[0] !== 'www' && parts[0] !== 'skiptray') {
    return parts[0];
  }

  return 'system';
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';

export const TenantProvider = ({ children }: { children: React.ReactNode }) => {
  const [tenantId, setTenantId]     = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string>('system');
  const [tenantName, setTenantName] = useState<string>('SkipTray');
  const [settings, setSettings]     = useState<TenantSettings | null>(null);
  const [isActive, setIsActive]     = useState<boolean>(true);
  const [loading, setLoading]       = useState<boolean>(true);
  const [error, setError]           = useState<'NOT_FOUND' | 'INACTIVE' | null>(null);

  useEffect(() => {
    const slug = extractSlug(window.location.hostname);
    setTenantSlug(slug);

    const resolveTenant = async () => {
      try {
        const functionsUrl = `${SUPABASE_URL.replace('/rest/v1', '')}/functions/v1`;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
        const res = await fetch(`${functionsUrl}/resolve-tenant?slug=${encodeURIComponent(slug)}`, {
          headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });

        if (res.status === 404) {
          setError('NOT_FOUND');
          setLoading(false);
          return;
        }

        if (!res.ok) {
          setError('NOT_FOUND');
          setLoading(false);
          return;
        }

        const data = await res.json();

        if (!data.is_active) {
          setTenantId(data.tenant_id);
          setTenantName(data.name);
          setSettings(data.settings);
          setIsActive(false);
          setError('INACTIVE');
          setLoading(false);
          return;
        }

        setTenantId(data.tenant_id);
        setTenantName(data.name);
        setSettings(data.settings);
        setIsActive(true);
        setError(null);

        // Apply tenant primary color as a CSS custom property
        if (data.settings?.primary_color) {
          document.documentElement.style.setProperty('--color-brand', data.settings.primary_color);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('TenantContext resolve error:', err);
        setError('NOT_FOUND');
      } finally {
        setLoading(false);
      }
    };

    resolveTenant();
  }, []);

  return (
    <TenantContext.Provider value={{ tenantId, tenantSlug, tenantName, settings, isActive, loading, error }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
