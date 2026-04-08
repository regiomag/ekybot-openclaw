import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { createClient, type SupabaseClient, type User as SupabaseUser } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

function getSupabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
}

function getSupabaseAnonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
}

function getSupabaseServiceRoleKey() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function assertSupabaseConfig() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return { url, anonKey };
}

function getNativeCapacitorFetch(): typeof fetch | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  if (!Capacitor.isNativePlatform()) {
    return undefined;
  }

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const headers = Object.fromEntries(request.headers.entries());
    const method = request.method || 'GET';
    const bodyText =
      method === 'GET' || method === 'HEAD' ? undefined : await request.text();

    const response = await CapacitorHttp.request({
      url: request.url,
      method,
      headers,
      data: bodyText,
      responseType: 'text',
      webFetchExtra: init,
    });

    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      if (Array.isArray(value)) {
        responseHeaders.set(key, value.join(', '));
      } else if (typeof value === 'string') {
        responseHeaders.set(key, value);
      }
    }

    const responseBody =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  };
}

export function isSupabaseConfigured() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  return Boolean(url && anonKey);
}

export function createSupabaseBrowserClient() {
  if (typeof window === 'undefined') {
    throw new Error('createSupabaseBrowserClient() can only be used in the browser.');
  }

  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = assertSupabaseConfig();
  const fetch = getNativeCapacitorFetch();

  browserClient = createClient(url, anonKey, {
    global: fetch ? { fetch } : undefined,
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

  return browserClient;
}

export function createFreshSupabaseBrowserClient(options: { detectSessionInUrl?: boolean } = {}) {
  if (typeof window === 'undefined') {
    throw new Error('createFreshSupabaseBrowserClient() can only be used in the browser.');
  }

  const { url, anonKey } = assertSupabaseConfig();
  const detectSessionInUrl = options.detectSessionInUrl ?? true;
  const fetch = getNativeCapacitorFetch();

  return createClient(url, anonKey, {
    global: fetch ? { fetch } : undefined,
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl,
      persistSession: true,
    },
  });
}

export function createSupabaseServerClient() {
  const { url, anonKey } = assertSupabaseConfig();

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getSupabaseUserForAccessToken(accessToken: string): Promise<SupabaseUser | null> {
  if (!accessToken || !isSupabaseConfigured()) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    return null;
  }

  return data.user ?? null;
}

export async function findSupabaseAuthUserByEmail(email: string): Promise<SupabaseUser | null> {
  if (!email || !isSupabaseConfigured()) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  let page = 1;

  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw error;
    }

    const matchedUser =
      data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;

    if (matchedUser) {
      return matchedUser;
    }

    if (data.users.length < 200) {
      break;
    }

    page += 1;
  }

  return null;
}
