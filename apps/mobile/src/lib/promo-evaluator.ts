import { minorToMoney, moneyToMinor } from '@ximo/shared';
import type { CartItem } from '@/store/cart';

export interface PromotionRule {
  id: string;
  name: string;
  type: string;
  minOrderQuantity?: number | null;
  discountPercentage?: string | null;
  discountAmount?: string | null;
  comboPrice?: string | null;
  isActive: boolean;
  items?: Array<{ productId: string; role?: string; requiredQuantity?: number }>;
}

export interface AppliedPromotion {
  id: string;
  name: string;
  type: string;
  discountMinor: bigint;
  discountMoney: string;
  description: string;
  appliedProductIds: Set<string>;
}

/**
 * Automatically evaluates the best qualifying promotion (Volume Tier, % Off, Fixed Off)
 * for the current cart items.
 */
export function evaluateCartPromotions(
  items: CartItem[],
  promotions: PromotionRule[],
): AppliedPromotion | null {
  if (!items.length || !promotions.length) return null;

  let bestPromo: AppliedPromotion | null = null;

  for (const promo of promotions) {
    if (!promo.isActive) continue;

    // If specific products are specified, filter for them; otherwise applies to all items
    const targetProductIds =
      promo.items && promo.items.length > 0
        ? new Set(promo.items.map((i) => i.productId))
        : null;

    const eligibleItems = targetProductIds
      ? items.filter((item) => targetProductIds.has(item.product.id))
      : items;

    if (!eligibleItems.length) continue;

    const eligibleQty = eligibleItems.reduce((sum, item) => sum + item.quantity, 0);
    const eligibleSubtotalMinor = eligibleItems.reduce(
      (sum, item) => sum + BigInt(Math.round(Number(moneyToMinor(item.product.sellingPrice)) * item.quantity)),
      0n,
    );

    let discountMinor = 0n;
    let description = '';

    if (promo.type === 'tiered_quantity') {
      const minQty = promo.minOrderQuantity || 1;
      if (eligibleQty >= minQty) {
        if (promo.discountPercentage) {
          const percent = Number(promo.discountPercentage);
          discountMinor = (eligibleSubtotalMinor * BigInt(Math.round(percent * 100))) / 10000n;
          description = `Volume Discount (${percent}% OFF for ${minQty}+)`;
        } else if (promo.discountAmount) {
          const fixedUnitMinor = moneyToMinor(promo.discountAmount);
          discountMinor = BigInt(Math.round(Number(fixedUnitMinor) * eligibleQty));
          if (discountMinor > eligibleSubtotalMinor) discountMinor = eligibleSubtotalMinor;
          description = `Volume Discount (₱${promo.discountAmount} off per item for ${minQty}+)`;
        }
      }
    } else if (promo.type === 'percentage_discount') {
      if (promo.discountPercentage) {
        const percent = Number(promo.discountPercentage);
        discountMinor = (eligibleSubtotalMinor * BigInt(Math.round(percent * 100))) / 10000n;
        description = `${percent}% OFF Promotion`;
      }
    } else if (promo.type === 'fixed_discount') {
      if (promo.discountAmount) {
        discountMinor = moneyToMinor(promo.discountAmount);
        if (discountMinor > eligibleSubtotalMinor) discountMinor = eligibleSubtotalMinor;
        description = `₱${promo.discountAmount} OFF Promotion`;
      }
    }

    if (discountMinor > 0n) {
      if (!bestPromo || discountMinor > bestPromo.discountMinor) {
        bestPromo = {
          id: promo.id,
          name: promo.name,
          type: promo.type,
          discountMinor,
          discountMoney: minorToMoney(discountMinor),
          description,
          appliedProductIds: new Set(eligibleItems.map((i) => i.product.id)),
        };
      }
    }
  }

  return bestPromo;
}

/**
 * Returns all promotions whose conditions the cart currently meets.
 * For tiered_quantity promos, the eligible quantity must meet minOrderQuantity.
 * For product-targeted promos, at least one target product must be in the cart.
 */
export function getQualifyingPromotions(
  items: CartItem[],
  promotions: PromotionRule[],
): AppliedPromotion[] {
  if (!items.length || !promotions.length) return [];

  const results: AppliedPromotion[] = [];

  for (const promo of promotions) {
    if (!promo.isActive) continue;

    const targetProductIds =
      promo.items && promo.items.length > 0
        ? new Set(promo.items.map((i) => i.productId))
        : null;

    const eligibleItems = targetProductIds
      ? items.filter((item) => targetProductIds.has(item.product.id))
      : items;

    if (!eligibleItems.length) continue;

    const eligibleQty = eligibleItems.reduce((sum, item) => sum + item.quantity, 0);
    const eligibleSubtotalMinor = eligibleItems.reduce(
      (sum, item) => sum + BigInt(Math.round(Number(moneyToMinor(item.product.sellingPrice)) * item.quantity)),
      0n,
    );

    let discountMinor = 0n;
    let description = '';

    if (promo.type === 'tiered_quantity') {
      const minQty = promo.minOrderQuantity || 1;
      if (eligibleQty < minQty) continue; // does NOT qualify
      if (promo.discountPercentage) {
        const percent = Number(promo.discountPercentage);
        discountMinor = (eligibleSubtotalMinor * BigInt(Math.round(percent * 100))) / 10000n;
        description = `Volume Discount (${percent}% OFF for ${minQty}+)`;
      } else if (promo.discountAmount) {
        const fixedUnitMinor = moneyToMinor(promo.discountAmount);
        discountMinor = BigInt(Math.round(Number(fixedUnitMinor) * eligibleQty));
        if (discountMinor > eligibleSubtotalMinor) discountMinor = eligibleSubtotalMinor;
        description = `Volume Discount (₱${promo.discountAmount} off per item for ${minQty}+)`;
      }
    } else if (promo.type === 'percentage_discount') {
      if (promo.discountPercentage) {
        const percent = Number(promo.discountPercentage);
        discountMinor = (eligibleSubtotalMinor * BigInt(Math.round(percent * 100))) / 10000n;
        description = `${percent}% OFF Promotion`;
      }
    } else if (promo.type === 'fixed_discount') {
      if (promo.discountAmount) {
        discountMinor = moneyToMinor(promo.discountAmount);
        if (discountMinor > eligibleSubtotalMinor) discountMinor = eligibleSubtotalMinor;
        description = `₱${promo.discountAmount} OFF Promotion`;
      }
    }

    if (discountMinor > 0n) {
      results.push({
        id: promo.id,
        name: promo.name,
        type: promo.type,
        discountMinor,
        discountMoney: minorToMoney(discountMinor),
        description,
        appliedProductIds: new Set(eligibleItems.map((i) => i.product.id)),
      });
    }
  }

  return results;
}
