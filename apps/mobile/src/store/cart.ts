import { create } from 'zustand';
import { minorToMoney, moneyToMinor, type ProductUnit } from '@ximo/shared';
import { appStorage } from '../lib/storage';

export interface CartProduct {
  id: string;
  name: string;
  sku: string;
  unit?: ProductUnit;
  unitKind?: 'discrete' | 'decimal';
  defaultStep?: number;
  baseUnit?: ProductUnit;
  variantId?: string | null;
  sellingUnitName?: string;
  unitsPerBase?: number;
  sellingUnits?: SellingUnit[];
  trackInventory?: boolean;
  categoryName?: string;
  barcodes?: string[];
  sellingPrice: string;
  taxRate: string;
  isTaxInclusive: boolean;
  status?: string;
  availableQuantity?: number | null;
  baseAvailableQuantity?: number | null;
}

export interface SellingUnit {
  variantId: string;
  name: string;
  sku: string;
  unit: ProductUnit;
  unitKind?: 'discrete' | 'decimal';
  defaultStep?: number;
  unitsPerBase: number;
  cost?: string;
  sellingPrice: string;
  barcodes?: string[];
}

export interface CartItem {
  product: CartProduct;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  customerId: string | null;
  hydrated: boolean;
  hydrate(): Promise<void>;
  add(product: CartProduct): void;
  setQuantity(productId: string, quantity: number): void;
  syncProducts(products: CartProduct[]): void;
  remove(productId: string): void;
  setCustomer(customerId: string | null): void;
  replaceCart(items: CartItem[], customerId?: string | null): void;
  clear(): void;
}

const CART_KEY = 'ximo.cart.v1';

export function quantityStep(product: Pick<CartProduct, 'unit' | 'defaultStep'>): number {
  if (product.defaultStep) return product.defaultStep;
  if (product.unit === 'kg' || product.unit === 'l') return 0.1;
  if (product.unit === 'g' || product.unit === 'ml') return 100;
  return 1;
}

export function cartProductKey(product: Pick<CartProduct, 'id' | 'variantId'>): string {
  return `${product.id}:${product.variantId ?? 'base'}`;
}

function matchesCartKey(product: CartProduct, key: string): boolean {
  return (
    cartProductKey(product) === key ||
    ((product.variantId === null || product.variantId === undefined) && product.id === key)
  );
}

export function selectSellingUnit(product: CartProduct, sellingUnit?: SellingUnit): CartProduct {
  if (!sellingUnit) {
    return {
      ...product,
      baseUnit: product.baseUnit ?? product.unit,
      variantId: null,
      sellingUnitName: undefined,
      unitsPerBase: 1,
      baseAvailableQuantity: product.baseAvailableQuantity ?? product.availableQuantity,
    };
  }
  const convertedAvailability =
    typeof product.availableQuantity === 'number'
      ? product.availableQuantity / sellingUnit.unitsPerBase
      : product.availableQuantity;
  const availableQuantity =
    typeof convertedAvailability === 'number'
      ? isDiscreteUnit(sellingUnit.unit, sellingUnit.unitKind)
        ? Math.floor(convertedAvailability)
        : normalizeQuantity(convertedAvailability)
      : convertedAvailability;
  return {
    ...product,
    sku: sellingUnit.sku,
    unit: sellingUnit.unit,
    unitKind: sellingUnit.unitKind,
    defaultStep: sellingUnit.defaultStep,
    baseUnit: product.baseUnit ?? product.unit,
    variantId: sellingUnit.variantId,
    sellingUnitName: sellingUnit.name,
    unitsPerBase: sellingUnit.unitsPerBase,
    sellingPrice: sellingUnit.sellingPrice,
    barcodes: sellingUnit.barcodes,
    availableQuantity,
    baseAvailableQuantity: product.baseAvailableQuantity ?? product.availableQuantity,
  };
}

export function normalizeQuantity(quantity: number): number {
  return Math.round(quantity * 1_000) / 1_000;
}

export function isDiscreteUnit(unit?: ProductUnit, kind?: 'discrete' | 'decimal'): boolean {
  if (kind) return kind === 'discrete';
  return unit === 'piece' || unit === 'serving' || unit === 'box' || unit === 'pack';
}

function quantityToThousandths(quantity: number): bigint {
  return BigInt(Math.round(quantity * 1_000));
}

function multiplyMoneyByQuantity(money: string, quantity: number): bigint {
  const scaled = moneyToMinor(money) * quantityToThousandths(quantity);
  return (scaled + 500n) / 1_000n;
}

async function saveCart(state: Pick<CartState, 'items' | 'customerId'>): Promise<void> {
  await appStorage.setItem(
    CART_KEY,
    JSON.stringify({ items: state.items, customerId: state.customerId }),
  );
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: null,
  hydrated: false,
  async hydrate() {
    const stored = await appStorage.getItem(CART_KEY);
    if (!stored) {
      set({ hydrated: true });
      return;
    }
    try {
      const value = JSON.parse(stored) as Pick<CartState, 'items' | 'customerId'>;
      set({ items: value.items ?? [], customerId: value.customerId ?? null, hydrated: true });
    } catch {
      await appStorage.removeItem(CART_KEY);
      set({ hydrated: true });
    }
  },
  add(product) {
    set((state) => {
      const key = cartProductKey(product);
      const existing = state.items.find((item) => cartProductKey(item.product) === key);
      const step = quantityStep(product);
      return {
        items: existing
          ? state.items.map((item) =>
              cartProductKey(item.product) === key
                ? { ...item, quantity: normalizeQuantity(item.quantity + step) }
                : item,
            )
          : [...state.items, { product, quantity: step }],
      };
    });
    void saveCart(get());
  },
  setQuantity(productId, quantity) {
    const normalized = normalizeQuantity(quantity);
    set((state) => ({
      items:
        normalized <= 0
          ? state.items.filter((item) => !matchesCartKey(item.product, productId))
          : state.items.map((item) =>
              matchesCartKey(item.product, productId) ? { ...item, quantity: normalized } : item,
            ),
    }));
    void saveCart(get());
  },
  syncProducts(products) {
    const latest = new Map(products.map((product) => [product.id, product]));
    set((state) => ({
      items: state.items.map((item) => {
        const product = latest.get(item.product.id);
        if (!product) return item;
        const unit = product.sellingUnits?.find(
          (sellingUnit) => sellingUnit.variantId === item.product.variantId,
        );
        return {
          ...item,
          product: selectSellingUnit({ ...item.product, ...product }, unit),
        };
      }),
    }));
    void saveCart(get());
  },
  remove(productId) {
    set((state) => ({
      items: state.items.filter((item) => !matchesCartKey(item.product, productId)),
    }));
    void saveCart(get());
  },
  setCustomer(customerId) {
    set({ customerId });
    void saveCart(get());
  },
  replaceCart(items, customerId) {
    set({ items, customerId: customerId ?? null });
    void saveCart(get());
  },
  clear() {
    set({ items: [], customerId: null });
    void appStorage.removeItem(CART_KEY);
  },
}));

export function cartSubtotal(items: CartItem[]): string {
  return minorToMoney(
    items.reduce(
      (sum, item) => sum + multiplyMoneyByQuantity(item.product.sellingPrice, item.quantity),
      0n,
    ),
  );
}

export function cartLineTotal(item: CartItem): string {
  return minorToMoney(multiplyMoneyByQuantity(item.product.sellingPrice, item.quantity));
}

export function hasCartStockConflict(items: CartItem[]): boolean {
  const consumed = new Map<string, number>();
  const available = new Map<string, number>();
  for (const item of items) {
    if (item.product.trackInventory === false) continue;
    consumed.set(
      item.product.id,
      (consumed.get(item.product.id) ?? 0) + item.quantity * (item.product.unitsPerBase ?? 1),
    );
    const baseAvailable =
      item.product.baseAvailableQuantity ??
      (typeof item.product.availableQuantity === 'number'
        ? item.product.availableQuantity * (item.product.unitsPerBase ?? 1)
        : null);
    if (typeof baseAvailable === 'number') available.set(item.product.id, baseAvailable);
  }
  return [...consumed].some(
    ([productId, quantity]) =>
      typeof available.get(productId) === 'number' && quantity > available.get(productId)!,
  );
}

function percentHundredths(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function cartTotal(items: CartItem[], fixedDiscount = '0.00'): string {
  const total = items.reduce((sum, item) => {
    const base = multiplyMoneyByQuantity(item.product.sellingPrice, item.quantity);
    if (item.product.isTaxInclusive) return sum + base;
    const rate = percentHundredths(item.product.taxRate);
    const tax = (base * rate + 5_000n) / 10_000n;
    return sum + base + tax;
  }, 0n);
  const discounted = total - moneyToMinor(fixedDiscount);
  return minorToMoney(discounted > 0n ? discounted : 0n);
}
