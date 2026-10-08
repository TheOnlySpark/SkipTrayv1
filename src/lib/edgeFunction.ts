import { supabase } from './supabase';

export interface EdgeFunctionOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Calls a Supabase Edge Function with guaranteed fresh session JWT.
 * Automatically attempts session refresh if expired or missing.
 */
export async function invokeEdgeFunction<T = any>(
  functionName: string,
  options: EdgeFunctionOptions = {}
): Promise<T> {
  const { method = 'POST', body } = options;

  // Retrieve current session
  let { data: { session }, error: sessionError } = await supabase.auth.getSession();

  // If session is absent or expired, attempt refresh
  if (!session || sessionError) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      throw new Error('Your login session has expired or is missing. Please log in again.');
    }
    session = refreshData.session;
  }

  const token = session.access_token;
  if (!token) {
    throw new Error('Your login session has expired. Please log in again.');
  }

  const baseUrl = import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL.replace('/rest/v1', '')}/functions/v1`
    : 'http://localhost:54321/functions/v1';

  const response = await fetch(`${baseUrl}/${functionName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch {
    // If not JSON
    if (!response.ok) {
      throw new Error(`Server returned error (${response.status}: ${response.statusText})`);
    }
    return {} as T;
  }

  if (!response.ok) {
    throw new Error(result?.error || result?.message || `Request failed (${response.status})`);
  }

  return result as T;
}
