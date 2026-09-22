import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
  setOnline: vi.fn(),
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  removeItem: vi.fn(async () => undefined),
  offlineSnapshotFallback: vi.fn(async () => undefined),
  connectivity: {
    initialized: false,
    isOnline: true,
  },
}));

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

vi.mock('./storage', () => ({
  appStorage: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
    removeItem: mocks.removeItem,
  },
}));

vi.mock('@/store/connectivity', () => ({
  useConnectivityStore: {
    getState: () => ({ ...mocks.connectivity, setOnline: mocks.setOnline }),
  },
}));

vi.mock('./offline-snapshot', () => ({
  offlineSnapshotFallback: mocks.offlineSnapshotFallback,
}));

function successfulResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function failingResponse(status: number) {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'UNAVAILABLE', message: 'Nope' } }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

async function loadApi(options: { primary?: string; local?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', options.primary ?? 'https://api.example.test/api/v1');
  vi.stubEnv('EXPO_PUBLIC_LOCAL_API_URL', options.local ?? 'http://127.0.0.1:4000/api/v1');
  return import('./api');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.connectivity.initialized = false;
  mocks.connectivity.isOnline = true;
});

describe('API base selection', () => {
  it('checks the configured live API before its explicit local fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failingResponse(503))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getApiBaseUrl, probeApiHealth } = await loadApi();

    await expect(probeApiHealth()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4000/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:4000/api/v1');
  });

  it('retries a safe request against the local API after a live transport failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce(successfulResponse({ id: 'product-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, getApiBaseUrl } = await loadApi();

    await expect(
      api<{ id: string }>('/products', { accessToken: 'access-token' }),
    ).resolves.toEqual({
      id: 'product-1',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/api/v1/products',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4000/api/v1/products',
      expect.any(Object),
    );
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:4000/api/v1');
  });

  it('does not replay a non-idempotent write on the alternate API', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('network failed'));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await loadApi();

    await expect(
      api('/products', { method: 'POST', body: JSON.stringify({ name: 'Tea' }) }),
    ).rejects.toThrow('network failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not store path-only cached identity data', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(successfulResponse({ id: 'user-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await loadApi({ local: undefined });

    await api('/auth/current', { accessToken: 'access-token' });
    expect(mocks.setItem).not.toHaveBeenCalled();
  });

  it('rechecks the authenticated workspace after an earlier offline session', async () => {
    mocks.connectivity.initialized = true;
    mocks.connectivity.isOnline = false;
    const fetchMock = vi.fn().mockResolvedValueOnce(successfulResponse({ id: 'user-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await loadApi({ local: undefined });

    await expect(api('/auth/current', { accessToken: 'access-token' })).resolves.toEqual({
      id: 'user-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
