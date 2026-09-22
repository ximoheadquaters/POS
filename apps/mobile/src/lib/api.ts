import type { ApiResponse } from '@ximo/shared';
import { supabase } from './supabase';
import { appStorage } from './storage';
import { useConnectivityStore } from '@/store/connectivity';
import { offlineSnapshotFallback } from './offline-snapshot';
import { isUiPreviewMode, previewApiResponse } from './ui-preview';

export const NETWORK_REQUEST_TIMEOUT_MS = 15_000;
const configuredApiUrl = normalizeApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL,
  'EXPO_PUBLIC_API_URL',
);
const configuredLocalApiUrl = normalizeLocalApiBaseUrl(process.env.EXPO_PUBLIC_LOCAL_API_URL);
let selectedApiBaseUrl = configuredApiUrl ?? configuredLocalApiUrl;

function normalizeApiBaseUrl(value: string | undefined, variableName: string): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${variableName} must be a valid http(s) URL ending in /api/v1.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${variableName} must use http or https.`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${variableName} must not include a query string or hash.`);
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname !== '/api/v1') {
    throw new Error(`${variableName} must end in /api/v1.`);
  }
  return `${parsed.origin}${pathname}`;
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === 'host.docker.internal' || host.endsWith('.local')) {
    return true;
  }
  if (host === '::1' || host === '[::1]' || host.startsWith('fe80:')) return true;

  const parts = host.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function normalizeLocalApiBaseUrl(value: string | undefined): string | undefined {
  const baseUrl = normalizeApiBaseUrl(value, 'EXPO_PUBLIC_LOCAL_API_URL');
  if (!baseUrl) return undefined;
  const host = new URL(baseUrl).hostname;
  if (!isLocalHost(host)) {
    throw new Error(
      'EXPO_PUBLIC_LOCAL_API_URL must point to localhost, a private network address, or a .local host.',
    );
  }
  return baseUrl;
}

function assertProductionApiUrl(): void {
  if (configuredApiUrl) return;
  // Production bundles need their live API URL. A local URL is only an explicitly
  // configured fallback and must not become the primary production destination.
  if (process.env.NODE_ENV !== 'production') return;
  throw new Error(
    'EXPO_PUBLIC_API_URL is required for production builds. Set it before running build:web.',
  );
}

assertProductionApiUrl();

function configuredApiBaseUrls(): string[] {
  return [configuredApiUrl, configuredLocalApiUrl].filter((url): url is string => Boolean(url));
}

export function getApiBaseUrl(): string {
  const baseUrl = selectedApiBaseUrl ?? configuredApiBaseUrls()[0];
  if (!baseUrl) {
    throw new Error(
      'No API URL is configured. Set EXPO_PUBLIC_API_URL and optionally EXPO_PUBLIC_LOCAL_API_URL.',
    );
  }
  return baseUrl;
}

export function getApiOrigin(): string {
  return getApiBaseUrl().replace(/\/api\/v1\/?$/, '');
}

function candidateApiBaseUrls(): string[] {
  const selected = selectedApiBaseUrl;
  const configured = configuredApiBaseUrls();
  return selected ? [selected, ...configured.filter((url) => url !== selected)] : configured;
}

function isSafeToReplayOnAlternateApi(method: string, idempotencyKey?: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || Boolean(idempotencyKey);
}

async function healthCheck(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/api\/v1\/?$/, '')}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

let pendingHealthProbe: Promise<boolean> | null = null;

/**
 * Selects the live API when possible and only uses the explicit local fallback
 * after the live health check fails. The selected base is reused by subsequent
 * requests, avoiding a slow failed live request before every local call.
 */
export function probeApiHealth(): Promise<boolean> {
  if (pendingHealthProbe) return pendingHealthProbe;
  pendingHealthProbe = (async () => {
    for (const baseUrl of configuredApiBaseUrls()) {
      if (await healthCheck(baseUrl)) {
        selectedApiBaseUrl = baseUrl;
        return true;
      }
    }
    return false;
  })().finally(() => {
    pendingHealthProbe = null;
  });
  return pendingHealthProbe;
}

function cacheKey(path: string): string {
  let hash = 5381;
  for (let index = 0; index < path.length; index += 1) {
    hash = (hash * 33) ^ path.charCodeAt(index);
  }
  return `ximo.api-cache.${(hash >>> 0).toString(36)}`;
}

function cacheable(path: string, method: string): boolean {
  if (method !== 'GET') return false;
  const pathname = path.split('?')[0] ?? path;
  // Identity is account-scoped. SessionProvider owns its separate, user-keyed
  // cache so a signed-out user can never inherit another account's context.
  if (pathname === '/auth/current') return false;
  if (pathname.startsWith('/reports') || pathname.startsWith('/sales/')) return false;
  // Product catalog is mutated in-place; a stale GET here makes Enable/Disable
  // look like it reverted and hides disabled rows from the list.
  if (pathname === '/products' || pathname === '/products/summary') return false;
  return true;
}

async function readOfflineFallback<T>(path: string, method: string): Promise<T | undefined> {
  if (method !== 'GET') return undefined;

  // Keep the response cache deliberately narrow: catalog records can be edited in-place and
  // must not be revived from an old response. Offline snapshots are a separate, branch-scoped
  // source and safely support the catalog, POS, inventory, and other saved workspace data.
  if (cacheable(path, method)) {
    const stored = await appStorage.getItem(cacheKey(path)).catch(() => null);
    if (stored) {
      try {
        return (JSON.parse(stored) as { data: T }).data;
      } catch {
        await appStorage.removeItem(cacheKey(path)).catch(() => undefined);
      }
    }
  }

  return offlineSnapshotFallback<T>(path);
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
  const { idempotencyKey, accessToken, signal: callerSignal, ...requestInit } = init;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  // The local UI preview deliberately uses sample data and never sends a request
  // to a POS server. It exists only when the reviewer opts in with ?preview=1.
  if (isUiPreviewMode()) return previewApiResponse<T>(path, method);
  const connectivity = useConnectivityStore.getState();
  // Auth context is the recovery path after the service comes back. Do not
  // short-circuit it from a stale offline flag left by a previous session.
  if (
    method === 'GET' &&
    connectivity.initialized &&
    !connectivity.isOnline &&
    path.split('?')[0] !== '/auth/current'
  ) {
    const offlineData = await readOfflineFallback<T>(path, method);
    if (offlineData !== undefined) return offlineData;
    throw new ApiError('The POS server is unavailable. Reconnect and try again.', 'OFFLINE', 0);
  }

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
  const baseUrls = candidateApiBaseUrls();
  if (baseUrls.length === 0) getApiBaseUrl();

  let lastError: unknown;
  let anyServerResponded = false;
  let canceledByCaller = false;

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index]!;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, NETWORK_REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

    let serverResponded = false;
    let responseStatus = 0;
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...requestInit,
        // The app maintains its own offline cache below. Bypassing the browser's
        // HTTP cache prevents stale 404 responses and body-less 304 responses
        // after a newly deployed API route becomes available.
        cache: 'no-store',
        headers,
        signal: controller.signal,
      });
      serverResponded = true;
      anyServerResponded = true;
      responseStatus = response.status;
      const body = (await response.json()) as ApiResponse<T>;
      if (!body.success) {
        throw new ApiError(
          body.error.message,
          body.error.code,
          response.status,
          body.error.details,
        );
      }

      selectedApiBaseUrl = baseUrl;
      useConnectivityStore.getState().setOnline(true);
      if (cacheable(path, method)) {
        void appStorage
          .setItem(
            cacheKey(path),
            JSON.stringify({ storedAt: new Date().toISOString(), data: body.data }),
          )
          .catch(() => undefined);
      }
      return body.data;
    } catch (error) {
      canceledByCaller = Boolean(callerSignal?.aborted) && !timedOut;
      const requestError = timedOut
        ? new Error('The server took too long to respond. Check your connection and try again.')
        : error;
      lastError = requestError;

      const canTryAlternate =
        !canceledByCaller &&
        index < baseUrls.length - 1 &&
        isSafeToReplayOnAlternateApi(method, idempotencyKey) &&
        (!serverResponded || responseStatus >= 500);
      if (canTryAlternate) continue;
      break;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  // An HTTP response means an API was reachable. Only failed transports should
  // put the workspace into its offline state.
  if (!canceledByCaller) useConnectivityStore.getState().setOnline(anyServerResponded);
  if (lastError instanceof ApiError && lastError.status < 500) throw lastError;
  if (!canceledByCaller) {
    const offlineData = await readOfflineFallback<T>(path, method);
    if (offlineData !== undefined) return offlineData;
    if (method === 'GET' && !anyServerResponded) {
      throw new ApiError('The POS server is unavailable. Reconnect and try again.', 'OFFLINE', 0);
    }
  }
  throw lastError ?? new Error('The API request could not be completed.');
}
