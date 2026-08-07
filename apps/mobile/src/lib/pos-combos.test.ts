import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number,
    ) {
      super(message);
    }
  }
  return { api, ApiError };
});

describe('fetchPosCombos', () => {
  beforeEach(() => {
    api.mockReset();
    vi.resetModules();
  });

  it('falls back to promotions list when /pos/promotions is missing', async () => {
    const { ApiError } = await import('@/lib/api');
    const { fetchPosCombos } = await import('./pos-combos');

    api.mockImplementation(async (path: string) => {
      if (path.startsWith('/pos/promotions')) {
        throw new ApiError('Not found', 'NOT_FOUND', 404);
      }
      if (path.startsWith('/promotions/pos-catalog')) {
        throw new ApiError('Not found', 'NOT_FOUND', 404);
      }
      if (path.startsWith('/promotions?')) {
        return [
          {
            id: 'promo-1',
            name: 'com1',
            type: 'combo_bundle',
            comboPrice: '50.00',
            isActive: true,
          },
        ];
      }
      if (path === '/promotions/promo-1') {
        return {
          id: 'promo-1',
          name: 'com1',
          type: 'combo_bundle',
          comboPrice: '50.00',
          isActive: true,
          items: [
            {
              productId: 'prod-1',
              role: 'combo_component',
              requiredQuantity: 1,
              productName: 'Cola',
              sku: 'SKU-1',
            },
          ],
        };
      }
      if (path === '/products/prod-1') {
        return {
          id: 'prod-1',
          name: 'Cola',
          sku: 'SKU-1',
          sellingPrice: '25.00',
          taxRate: '0.00',
          isTaxInclusive: true,
          trackInventory: true,
          status: 'active',
        };
      }
      if (path.startsWith('/inventory')) {
        return [{ productId: 'prod-1', quantity: 10 }];
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const combos = await fetchPosCombos('branch-1');
    expect(combos).toHaveLength(1);
    expect(combos[0]?.name).toBe('com1');
    expect(combos[0]?.components[0]?.sellingPrice).toBe('25.00');
  });
});
