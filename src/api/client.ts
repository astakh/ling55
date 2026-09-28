export class ApiError extends Error {
  code: string;
  details?: any;
  status: number;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = localStorage.getItem('token');
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      setAccessToken(null);
      return null;
    }
    const data = await res.json();
    if (data.access_token) {
      setAccessToken(data.access_token);
      return data.access_token;
    }
  } catch (err) {
    setAccessToken(null);
  }
  return null;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let response = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  // Handle 401 token refresh
  if (response.status === 401 && !endpoint.startsWith('/auth/')) {
    if (!isRefreshing) {
      isRefreshing = true;
      const newToken = await refreshAccessToken();
      isRefreshing = false;
      if (newToken) {
        onRefreshed(newToken);
        headers.set('Authorization', `Bearer ${newToken}`);
        response = await fetch(`/api${endpoint}`, { ...options, headers });
      } else {
        // Dispatch logout event if needed
        window.dispatchEvent(new Event('auth:logout'));
      }
    } else {
      // Wait for ongoing refresh
      const retryPromise = new Promise<string>((resolve) => {
        refreshSubscribers.push((token: string) => resolve(token));
      });
      const newToken = await retryPromise;
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(`/api${endpoint}`, { ...options, headers });
    }
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errObj = data?.error || {};
    throw new ApiError(
      response.status,
      errObj.code || 'unknown_error',
      errObj.message || 'Произошла непредвиденная ошибка',
      errObj.details
    );
  }

  return data as T;
}
