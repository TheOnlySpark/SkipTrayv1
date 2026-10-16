import { supabase } from './supabase';

export interface EdgeFunctionOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Calls a Supabase Edge Function with the current authenticated user session.
 * Uses supabase.functions.invoke which automatically manages apikey and Authorization headers.
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

  if (!session?.access_token) {
    throw new Error('Your login session has expired. Please log in again.');
  }

  // Use the official supabase.functions.invoke client method
  const { data, error } = await supabase.functions.invoke(functionName, {
    method,
    body: body as any,
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (error) {
    let errorMsg = error.message;
    // Extract server error payload if available
    if ((error as any).context && typeof (error as any).context.json === 'function') {
      try {
        const errJson = await (error as any).context.json();
        if (errJson?.error) errorMsg = errJson.error;
        else if (errJson?.message) errorMsg = errJson.message;
      } catch {
        // ignore json parse error
      }
    }
    throw new Error(errorMsg || 'Failed to execute request');
  }

  return data as T;
}

