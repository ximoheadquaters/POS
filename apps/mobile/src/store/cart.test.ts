import { beforeEach, describe, expect, it } from 'vitest';
import { cartProductKey, cartTotal, selectSellingUnit, useCartStore } from './cart';

const product = {
  id: 'product-1',
  name: 'Demo product',
  sku: 'DEMO-1',
  sellingPrice: '15.00',
  taxRate: '12.00',
  isTaxInclusive: false,
};

describe('cashier cart behavior', () => {
  beforeEach(() => useCartStore.getState().clear());

  it('adds, increments, changes quantity, and removes a cart item', () => {
    useCartStore.getState().add(product);
    useCartStore.getState().add(product);
    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
    expect(cartTotal(useCartStore.getState().items)).toBe('33.60');

    useCartStore.getState().setQuantity(product.id, 3);
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);

    useCartStore.getState().remove(product.id);
    expect(useCartStore.getState().items).toEqual([]);
  });

  it('calculates a fixed discount using integer minor units', () => {
    useCartStore.getState().add({ ...product, sellingPrice: '0.10' });
    expect(cartTotal(useCartStore.getState().items, '0.01')).toBe('0.10');
  });

  it('calculates products sold by fractional weight', () => {
    useCartStore.getState().add({
      ...product,
      unit: 'kg',
      sellingPrice: '320.00',
    });
    useCartStore.getState().setQuantity(product.id, 0.25);
    expect(cartTotal(useCartStore.getState().items)).toBe('89.60');
  });

  it('synchronizes live product availability into an existing cart', () => {
    useCartStore.getState().add({ ...product, availableQuantity: 5 });
    useCartStore.getState().syncProducts([{ ...product, availableQuantity: 2 }]);

    expect(useCartStore.getState().items[0]?.product.availableQuantity).toBe(2);
  });

  it('keeps piece and pack sales separate for the same product', () => {
    const base = {
      ...product,
      unit: 'piece' as const,
      sellingUnits: [
        {
          variantId: 'variant-pack',
          name: 'Pack of 10',
          sku: 'DEMO-PACK',
          unit: 'pack' as const,
          unitsPerBase: 10,
          sellingPrice: '140.00',
        },
      ],
    };
    useCartStore.getState().add(base);
    useCartStore.getState().add(selectSellingUnit(base, base.sellingUnits[0]));

    expect(useCartStore.getState().items).toHaveLength(2);
    expect(useCartStore.getState().items.map((item) => cartProductKey(item.product))).toEqual([
      'product-1:base',
      'product-1:variant-pack',
    ]);
  });
});
