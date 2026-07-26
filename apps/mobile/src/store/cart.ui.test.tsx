import { act, renderHook } from '@testing-library/react-native';
import { useCartStore } from './cart';

const product = {
  id: 'product-1',
  name: 'Demo product',
  sku: 'DEMO-1',
  sellingPrice: '15.00',
  taxRate: '12.00',
  isTaxInclusive: false,
};

describe('active cart hook', () => {
  beforeEach(() => useCartStore.getState().clear());

  it('rerenders cashier UI subscribers when an item is added and removed', async () => {
    const { result } = await renderHook(() => useCartStore());

    await act(() => result.current.add(product));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.product.name).toBe('Demo product');

    await act(() => result.current.remove(product.id));
    expect(result.current.items).toHaveLength(0);
  });
});
