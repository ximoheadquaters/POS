import type { ApiResponse } from '@ximo/shared';
import { supabase } from './supabase';
import { appStorage } from './storage';
import { useConnectivityStore } from '@/store/connectivity';
import { offlineSnapshotFallback } from './offline-snapshot';

const getDefaultApiUrl = () => {
  // When running locally on the web, always use the local API server
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    return `http://localhost:${4000}/api/v1`;
  }
  return process.env.EXPO_PUBLIC_API_URL ?? 'https://ximo-pos-api.onrender.com/api/v1';
};

const baseUrl = getDefaultApiUrl();
export const API_ORIGIN = baseUrl.replace(/\/api\/v1\/?$/, '');

function cacheKey(path: string): string {
  let hash = 5381;
  for (let index = 0; index < path.length; index += 1) {
    hash = (hash * 33) ^ path.charCodeAt(index);
  }
  return `ximo.api-cache.${(hash >>> 0).toString(36)}`;
}

function cacheable(path: string, method: string): boolean {
  return method === 'GET' && !path.startsWith('/reports') && !path.startsWith('/sales/');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string; accessToken?: string } = {},
): Promise<T> {
  const { idempotencyKey, accessToken, ...requestInit } = init;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  let token = accessToken;
  if (!token) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    token = session?.access_token;
  }
  const headers = new Headers(requestInit.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  let serverResponded = false;
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...requestInit,
      // The app maintains its own offline cache below. Bypassing the browser's
      // HTTP cache prevents stale 404 responses and body-less 304 responses
      // after a newly deployed API route becomes available.
      cache: 'no-store',
      headers,
    });
    serverResponded = true;
    const body = (await response.json()) as ApiResponse<T>;
    if (!body.success) {
      throw new ApiError(body.error.message, body.error.code, response.status, body.error.details);
    }
    useConnectivityStore.getState().setOnline(true);
    if (cacheable(path, method)) {
      await appStorage.setItem(
        cacheKey(path),
        JSON.stringify({ storedAt: new Date().toISOString(), data: body.data }),
      );
    }
    return body.data;
  } catch (error) {
    // An HTTP error means the API is reachable. Only a transport failure means
    // the device should enter offline mode.
    useConnectivityStore.getState().setOnline(serverResponded);
    if (error instanceof ApiError && error.status < 500) throw error;
    if (cacheable(path, method)) {
      const stored = await appStorage.getItem(cacheKey(path));
      if (stored) {
        try {
          return (JSON.parse(stored) as { data: T }).data;
        } catch {
          await appStorage.removeItem(cacheKey(path));
        }
      }
      const snapshot = await offlineSnapshotFallback<T>(path);
      if (snapshot !== undefined) return snapshot;
    }
    throw error;
  }
}
