import { describe, expect, it } from 'vitest';
import { allocateComboUnitPrices, comboCartLines, comboSoldOut } from './combo-cart';

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
    const lines = comboCartLines({
      id: 'promo-1',
      name: 'Snack Combo',
      type: 'combo_bundle',
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
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.product.priceLocked).toBe(true);
    expect(lines[0]?.product.promoName).toBe('Snack Combo');
    const totalMinor =
      Number(lines[0]!.product.sellingPrice) * lines[0]!.quantity +
      Number(lines[1]!.product.sellingPrice) * lines[1]!.quantity;
    expect(totalMinor).toBe(40);
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
