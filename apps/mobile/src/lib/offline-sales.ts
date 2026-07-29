import { appStorage } from './storage';
import { ApiError, api } from './api';

const QUEUE_KEY = 'ximo.offline-sales.v1';

export interface QueuedCheckout {
  id: string;
  idempotencyKey: string;
  createdAt: string;
  total: string;
  body: Record<string, unknown>;
  status?: 'pending' | 'failed';
  attempts?: number;
  lastAttemptAt?: string;
  lastError?: string;
}

export interface OfflineSyncResult {
  pending: number;
  failed: number;
  synced: number;
}

export async function getOfflineSales(): Promise<QueuedCheckout[]> {
  const stored = await appStorage.getItem(QUEUE_KEY);
  if (!stored) return [];
  try {
    const value = JSON.parse(stored) as QueuedCheckout[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function saveOfflineSales(queue: QueuedCheckout[]): Promise<void> {
  if (queue.length) await appStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  else await appStorage.removeItem(QUEUE_KEY);
}

export async function enqueueOfflineSale(sale: QueuedCheckout): Promise<number> {
  const queue = await getOfflineSales();
  queue.push(sale);
  await saveOfflineSales(queue);
  return queue.length;
}

export async function retryOfflineSale(id: string): Promise<void> {
  const queue = await getOfflineSales();
  await saveOfflineSales(
    queue.map((sale) =>
      sale.id === id ? { ...sale, status: 'pending', lastError: undefined } : sale,
    ),
  );
}

export async function removeOfflineSale(id: string): Promise<void> {
  const queue = await getOfflineSales();
  await saveOfflineSales(queue.filter((sale) => sale.id !== id));
}

export async function syncOfflineSales(): Promise<OfflineSyncResult> {
  const queue = await getOfflineSales();
  const remaining: QueuedCheckout[] = [];
  let synced = 0;
  for (const sale of queue) {
    if (sale.status === 'failed') {
      remaining.push(sale);
      continue;
    }
    try {
      await api('/sales/checkout', {
        method: 'POST',
        idempotencyKey: sale.idempotencyKey,
        body: JSON.stringify(sale.body),
      });
      synced += 1;
    } catch (error) {
      const permanent =
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 408, 429].includes(error.status);
      remaining.push({
        ...sale,
        status: permanent ? 'failed' : 'pending',
        attempts: (sale.attempts ?? 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : 'Synchronization failed',
      });
      if (!permanent) {
        const later = queue.slice(queue.indexOf(sale) + 1);
        remaining.push(...later);
        break;
      }
    }
  }
  await saveOfflineSales(remaining);
  return {
    pending: remaining.filter((sale) => sale.status !== 'failed').length,
    failed: remaining.filter((sale) => sale.status === 'failed').length,
    synced,
  };
}
