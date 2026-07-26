import { beforeEach, describe, expect, it } from 'vitest';
import { cartTotal, useCartStore } from './cart';

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
});
