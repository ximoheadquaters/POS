import { create } from 'zustand';

interface ConnectivityState {
  isOnline: boolean;
  initialized: boolean;
  pendingSales: number;
  failedSales: number;
  reservedByProduct: Record<string, number>;
  setOnline(isOnline: boolean): void;
  setPendingSales(count: number): void;
  setOfflineQueue(
    queue: Array<{ body: Record<string, unknown>; status?: 'pending' | 'failed' }>,
  ): void;
}

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  isOnline: true,
  initialized: false,
  pendingSales: 0,
  failedSales: 0,
  reservedByProduct: {},
  setOnline: (isOnline) =>
    set((state) =>
      state.initialized && state.isOnline === isOnline ? state : { isOnline, initialized: true },
    ),
  setPendingSales: (pendingSales) =>
    set((state) => (state.pendingSales === pendingSales ? state : { pendingSales })),
  setOfflineQueue: (queue) => {
    const reservedByProduct: Record<string, number> = {};
    for (const sale of queue) {
      const items = Array.isArray(sale.body.items)
        ? (sale.body.items as Array<{
            productId?: string;
            quantity?: number;
            unitsPerBase?: number;
          }>)
        : [];
      for (const item of items) {
        if (!item.productId || !item.quantity) continue;
        reservedByProduct[item.productId] =
          (reservedByProduct[item.productId] ?? 0) + item.quantity * (item.unitsPerBase ?? 1);
      }
    }
    set({
      pendingSales: queue.filter((sale) => sale.status !== 'failed').length,
      failedSales: queue.filter((sale) => sale.status === 'failed').length,
      reservedByProduct,
    });
  },
}));
