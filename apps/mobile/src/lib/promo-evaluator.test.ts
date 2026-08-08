import { describe, expect, it } from 'vitest';
import { evaluateCartPromotions, type PromotionRule } from './promo-evaluator';
import type { CartItem } from '@/store/cart';

describe('evaluateCartPromotions', () => {
  const waterItem: CartItem = {
    product: {
      id: 'water-1',
      name: 'Bottled Water',
      sku: 'WATER-1',
      sellingPrice: '220.00',
      taxRate: '12.00',
      isTaxInclusive: false,
    },
    quantity: 1,
  };

  it('applies volume discount automatically when minimum quantity is reached', () => {
    const promo: PromotionRule = {
      id: 'promo-vol-1',
      name: 'Bulk Water 5+',
      type: 'tiered_quantity',
      minOrderQuantity: 5,
      discountPercentage: '10.00',
      isActive: true,
      items: [{ productId: 'water-1' }],
    };

    // 1 item (below 5) -> No discount
    expect(evaluateCartPromotions([waterItem], [promo])).toBeNull();

    // 5 items (meets threshold) -> 10% off of 5 * 220 = 1100 => 110.00 discount
    const fiveWater: CartItem = { ...waterItem, quantity: 5 };
    const result = evaluateCartPromotions([fiveWater], [promo]);
    expect(result).not.toBeNull();
    expect(result?.discountMoney).toBe('110.00');
    expect(result?.appliedProductIds.has('water-1')).toBe(true);
  });

  it('applies fixed discount off when minimum quantity is reached', () => {
    const promo: PromotionRule = {
      id: 'promo-vol-2',
      name: 'Bulk Water ₱20 off',
      type: 'tiered_quantity',
      minOrderQuantity: 5,
      discountAmount: '20.00',
      isActive: true,
    };

    // 5 items * 20.00 = 100.00 discount
    const fiveWater: CartItem = { ...waterItem, quantity: 5 };
    const result = evaluateCartPromotions([fiveWater], [promo]);
    expect(result).not.toBeNull();
    expect(result?.discountMoney).toBe('100.00');
  });

  it('ignores inactive promotions', () => {
    const promo: PromotionRule = {
      id: 'promo-vol-3',
      name: 'Inactive',
      type: 'tiered_quantity',
      minOrderQuantity: 1,
      discountPercentage: '50.00',
      isActive: false,
    };

    expect(evaluateCartPromotions([waterItem], [promo])).toBeNull();
  });
});
