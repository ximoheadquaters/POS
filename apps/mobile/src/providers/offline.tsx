import { useEffect, useRef, type PropsWithChildren } from 'react';
import { AppState, InteractionManager, Platform, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api, probeApiHealth } from '@/lib/api';
import { getOfflineSales, syncOfflineSales } from '@/lib/offline-sales';
import { saveOfflineSnapshot } from '@/lib/offline-snapshot';
import { useCartStore } from '@/store/cart';
import { useBranchStore } from '@/store/branch';
import { useConnectivityStore } from '@/store/connectivity';
import { useSession } from '@/providers/session';
import { isUiPreviewMode } from '@/lib/ui-preview';

const HEALTHY_CHECK_INTERVAL_MS = 30_000;
const UNAVAILABLE_RETRY_INTERVAL_MS = 60_000;

async function allPages(path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await api<unknown[]>(`${path}${separator}page=${page}&pageSize=100`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function downloadBranchSnapshot(branchId: string) {
  const [
    products,
    posProducts,
    inventory,
    customers,
    categories,
    brands,
    units,
    registers,
    settings,
  ] = await Promise.all([
    allPages(`/products?branchId=${branchId}`),
    allPages(`/products?usage=pos&branchId=${branchId}`),
    allPages(`/inventory?branchId=${branchId}`),
    allPages(`/customers?branchId=${branchId}&search=`),
    api<unknown[]>(`/categories?branchId=${branchId}`),
    api<unknown[]>(`/brands?branchId=${branchId}`),
    api<unknown[]>('/product-units'),
    api<unknown[]>(`/registers?branchId=${branchId}`),
    api<unknown>('/settings'),
  ]);
  await saveOfflineSnapshot({
    branchId,
    syncedAt: new Date().toISOString(),
    products,
    posProducts,
    inventory,
    customers,
    categories,
    brands,
    units,
    registers,
    settings,
  });
}

function scheduleWhenIdle(task: () => void): () => void {
  if (Platform.OS === 'web') {
    const idleWindow = globalThis as typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(task, { timeout: 4_000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
  }

  const interaction = InteractionManager.runAfterInteractions(task);
  return () => interaction.cancel();
}

export function OfflineProvider({ children }: PropsWithChildren) {
  const previewMode = isUiPreviewMode();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const lastSnapshotAt = useRef(0);
  const isOnline = useConnectivityStore((state) => state.isOnline);
  const initialized = useConnectivityStore((state) => state.initialized);
  const pendingSales = useConnectivityStore((state) => state.pendingSales);
  const failedSales = useConnectivityStore((state) => state.failedSales);
  const setOnline = useConnectivityStore((state) => state.setOnline);
  const setPendingSales = useConnectivityStore((state) => state.setPendingSales);
  const setOfflineQueue = useConnectivityStore((state) => state.setOfflineQueue);
  const hydrateCart = useCartStore((state) => state.hydrate);

  useEffect(() => {
    void hydrateCart();
    void getOfflineSales().then(setOfflineQueue);
  }, [hydrateCart, setOfflineQueue]);

  useEffect(() => {
    if (previewMode) {
      setOnline(true);
      setOfflineQueue([]);
      return;
    }
    // Authentication uses Supabase directly. Avoid an unrelated API health request
    // while the sign-in screen is visible.
    if (!session) return;

    let active = true;
    let checking = false;
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    let snapshotScheduled = false;
    let cancelScheduledSnapshot: (() => void) | undefined;

    const scheduleNextCheck = (delay: number) => {
      if (!active) return;
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(() => void check(), delay);
    };

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const online = await probeApiHealth();
        if (!active) return;
        setOnline(online);
        if (!online) {
          scheduleNextCheck(UNAVAILABLE_RETRY_INTERVAL_MS);
          return;
        }

        try {
          const result = await syncOfflineSales();
          if (!active) return;
          const queue = await getOfflineSales();
          setOfflineQueue(queue);
          setPendingSales(result.pending);
          if (result.synced) {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['sales'] }),
              queryClient.invalidateQueries({ queryKey: ['inventory'] }),
              queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
              queryClient.invalidateQueries({ queryKey: ['reports'] }),
            ]);
          }
        } catch {
          // A rejected queued sale is a sync error, not a loss of connectivity.
        }

        if (branch?.id && !snapshotScheduled && Date.now() - lastSnapshotAt.current > 5 * 60_000) {
          snapshotScheduled = true;
          const branchId = branch.id;
          // A complete offline snapshot is useful, but it is expensive. Let the first
          // screen finish rendering before starting its paginated download.
          cancelScheduledSnapshot = scheduleWhenIdle(() => {
            snapshotScheduled = false;
            if (!active) return;
            // Record the attempt first so a server/schema error cannot retry every
            // 15 seconds and make the interface appear to refresh.
            lastSnapshotAt.current = Date.now();
            void downloadBranchSnapshot(branchId).catch(() => {
              // Keep the previous snapshot and retry at the next snapshot interval.
            });
          });
        }
        scheduleNextCheck(HEALTHY_CHECK_INTERVAL_MS);
      } finally {
        checking = false;
      }
    };
    void check();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    const online = () => void check();
    const offline = () => setOnline(false);
    if (Platform.OS === 'web') {
      globalThis.addEventListener?.('online', online);
      globalThis.addEventListener?.('offline', offline);
    }
    return () => {
      active = false;
      cancelScheduledSnapshot?.();
      if (checkTimer) clearTimeout(checkTimer);
      appState.remove();
      if (Platform.OS === 'web') {
        globalThis.removeEventListener?.('online', online);
        globalThis.removeEventListener?.('offline', offline);
      }
    };
  }, [branch?.id, previewMode, queryClient, session, setOfflineQueue, setOnline, setPendingSales]);

  const banner =
    failedSales > 0
      ? `${failedSales} offline ${failedSales === 1 ? 'sale needs' : 'sales need'} attention`
      : isOnline
        ? `Syncing ${pendingSales} offline ${pendingSales === 1 ? 'sale' : 'sales'}…`
        : `POS server unavailable${pendingSales ? ` · ${pendingSales} sale${pendingSales === 1 ? '' : 's'} waiting to sync` : ''}`;

  return (
    <View className="flex-1">
      {session && initialized && (!isOnline || pendingSales > 0 || failedSales > 0) ? (
        <View
          className={`px-4 py-2 ${
            failedSales ? 'bg-red-100' : isOnline ? 'bg-amber-100' : 'bg-slate-800'
          }`}
        >
          <Text
            className={`text-center text-xs font-medium ${
              failedSales ? 'text-red-900' : isOnline ? 'text-amber-900' : 'text-white'
            }`}
          >
            {banner}
          </Text>
        </View>
      ) : null}
      <View className="flex-1">{children}</View>
    </View>
  );
}
