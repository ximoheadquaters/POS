import { create } from 'zustand';
import { minorToMoney, moneyToMinor } from '@ximo/shared';

export interface CartProduct {
  id: string;
  name: string;
  sku: string;
  barcodes?: string[];
  sellingPrice: string;
  taxRate: string;
  isTaxInclusive: boolean;
}

export interface CartItem {
  product: CartProduct;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  customerId: string | null;
  add(product: CartProduct): void;
  setQuantity(productId: string, quantity: number): void;
  remove(productId: string): void;
  setCustomer(customerId: string | null): void;
  clear(): void;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  customerId: null,
  add(product) {
    set((state) => {
      const existing = state.items.find((item) => item.product.id === product.id);
      return {
        items: existing
          ? state.items.map((item) =>
              item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
            )
          : [...state.items, { product, quantity: 1 }],
      };
    });
  },
  setQuantity(productId, quantity) {
    set((state) => ({
      items:
        quantity <= 0
          ? state.items.filter((item) => item.product.id !== productId)
          : state.items.map((item) =>
              item.product.id === productId ? { ...item, quantity } : item,
            ),
    }));
  },
  remove(productId) {
    set((state) => ({ items: state.items.filter((item) => item.product.id !== productId) }));
  },
  setCustomer(customerId) {
    set({ customerId });
  },
  clear() {
    set({ items: [], customerId: null });
  },
}));

export function cartSubtotal(items: CartItem[]): string {
  return minorToMoney(
    items.reduce(
      (sum, item) => sum + moneyToMinor(item.product.sellingPrice) * BigInt(item.quantity),
      0n,
    ),
  );
}

function percentHundredths(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function cartTotal(items: CartItem[], fixedDiscount = '0.00'): string {
  const total = items.reduce((sum, item) => {
    const base = moneyToMinor(item.product.sellingPrice) * BigInt(item.quantity);
    if (item.product.isTaxInclusive) return sum + base;
    const rate = percentHundredths(item.product.taxRate);
    const tax = (base * rate + 5_000n) / 10_000n;
    return sum + base + tax;
  }, 0n);
  const discounted = total - moneyToMinor(fixedDiscount);
  return minorToMoney(discounted > 0n ? discounted : 0n);
}
