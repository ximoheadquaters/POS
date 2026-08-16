import { describe, expect, it } from 'vitest';
import {
  allocateComboUnitPrices,
  cartComponentQuantities,
  checkoutLineTotalMinor,
  comboCartBundle,
  comboCartLines,
  comboIncludesLabel,
  comboSoldOut,
  expandCartItemsForApi,
} from './combo-cart';

const snackCombo = {
  id: 'promo-1',
  name: 'Snack Combo',
  type: 'combo_bundle' as const,
  comboPrice: '40.00',
  components: [
    {
      productId: 'a',
      id: 'a',
      name: 'Chips',
      sku: 'C1',
      requiredQuantity: 1,
      role: 'combo_component',
      sellingPrice: '30.00',
      taxRate: '0.00',
      isTaxInclusive: true,
    },
    {
      productId: 'b',
      id: 'b',
      name: 'Drink',
      sku: 'D1',
      requiredQuantity: 1,
      role: 'combo_component',
      sellingPrice: '25.00',
      taxRate: '0.00',
      isTaxInclusive: true,
    },
  ],
};

describe('allocateComboUnitPrices', () => {
  it('splits combo price proportional to regular line totals', () => {
    const prices = allocateComboUnitPrices(
      [
        { sellingPrice: '25.00', requiredQuantity: 1 },
        { sellingPrice: '30.00', requiredQuantity: 1 },
      ],
      '44.00',
    );
    expect(prices).toEqual(['20.00', '24.00']);
  });

  it('handles multi-quantity components', () => {
    const prices = allocateComboUnitPrices(
      [
        { sellingPrice: '10.00', requiredQuantity: 2 },
        { sellingPrice: '20.00', requiredQuantity: 1 },
      ],
      '30.00',
    );
    // weights 20 + 20 = 40; lines 15 + 15; unit prices 7.50 and 15.00
    expect(prices).toEqual(['7.50', '15.00']);
  });
});

describe('comboCartLines', () => {
  it('locks allocated prices on cart products', () => {
    const lines = comboCartLines(snackCombo);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.product.priceLocked).toBe(true);
    expect(lines[0]?.product.promoName).toBe('Snack Combo');
    const totalMinor =
      Number(lines[0]!.product.sellingPrice) * lines[0]!.quantity +
      Number(lines[1]!.product.sellingPrice) * lines[1]!.quantity;
    expect(totalMinor).toBe(40);
  });
});

describe('comboCartBundle', () => {
  it('stores a single combo row with expandable components', () => {
    const bundle = comboCartBundle(snackCombo);
    expect(bundle.isComboBundle).toBe(true);
    expect(bundle.name).toBe('Snack Combo');
    expect(bundle.sellingPrice).toBe('40.00');
    expect(bundle.comboComponents).toHaveLength(2);
    expect(comboIncludesLabel(bundle.comboComponents)).toBe('Chips · Drink');
  });
});

describe('expandCartItemsForApi', () => {
  it('expands combo bundles into priced component lines', () => {
    const bundle = comboCartBundle(snackCombo);
    const expanded = expandCartItemsForApi([{ product: bundle, quantity: 2 }]);
    expect(expanded).toHaveLength(2);
    expect(expanded[0]?.quantity).toBe(2);
    expect(expanded[1]?.quantity).toBe(2);
    expect(expanded[0]?.unitPrice).toBeTruthy();
    expect(expanded[0]?.promoId).toBe('promo-1');
  });

  it('keeps checkout totals equal to the combo sticker when components are tax-exclusive', () => {
    const exclusiveCombo = {
      ...snackCombo,
      id: 'promo-tax',
      comboPrice: '40.00',
      components: snackCombo.components.map((component) => ({
        ...component,
        taxRate: '12.00',
        isTaxInclusive: false,
      })),
    };
    const bundle = comboCartBundle(exclusiveCombo);
    const expanded = expandCartItemsForApi([{ product: bundle, quantity: 1 }]);
    const due = exclusiveCombo.components.reduce((sum, component, index) => {
      const line = expanded[index]!;
      return (
        sum +
        checkoutLineTotalMinor(
          line.unitPrice!,
          line.quantity,
          component.taxRate,
          component.isTaxInclusive,
        )
      );
    }, 0n);
    expect(due).toBe(4000n);
  });
});

describe('cartComponentQuantities', () => {
  it('counts combo component demand for stock checks', () => {
    const bundle = comboCartBundle(snackCombo);
    const quantities = cartComponentQuantities([{ product: bundle, quantity: 1 }]);
    expect(quantities.get('a')).toBe(1);
    expect(quantities.get('b')).toBe(1);
  });
});

describe('comboSoldOut', () => {
  it('blocks when a tracked component lacks stock for the required qty', () => {
    const soldOut = comboSoldOut(
      {
        id: 'promo-1',
        name: 'Combo',
        type: 'combo_bundle',
        comboPrice: '10.00',
        components: [
          {
            productId: 'a',
            id: 'a',
            name: 'A',
            sku: 'A',
            requiredQuantity: 2,
            role: 'combo_component',
            sellingPrice: '5.00',
            taxRate: '0.00',
            isTaxInclusive: true,
            trackInventory: true,
            availableQuantity: 1,
          },
        ],
      },
      new Map(),
    );
    expect(soldOut).toBe(true);
  });
});
