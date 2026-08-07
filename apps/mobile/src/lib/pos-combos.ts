import { ApiError, api } from '@/lib/api';
import type { PosComboComponent, PosComboPromotion } from '@/lib/combo-cart';

interface PromotionSummary {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  type: string;
  comboPrice?: string | null;
  isActive: boolean;
}

interface PromotionDetail extends PromotionSummary {
  items: Array<{
    productId: string;
    role: string;
    requiredQuantity: number;
    productName?: string;
    sku?: string;
  }>;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  unit?: PosComboComponent['unit'];
  unitKind?: PosComboComponent['unitKind'];
  defaultStep?: number;
  trackInventory?: boolean;
  sellingPrice: string;
  taxRate: string;
  isTaxInclusive: boolean;
  status?: string;
  categoryName?: string | null;
}

interface InventoryRow {
  productId: string;
  quantity: number;
}

function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.code === 'NOT_FOUND');
}

async function enrichComponent(
  item: PromotionDetail['items'][number],
  branchId: string,
): Promise<PosComboComponent | null> {
  try {
    const product = await api<ProductRow>(`/products/${item.productId}`);
    if (product.status && product.status !== 'active') return null;

    let availableQuantity: number | null = null;
    if (product.trackInventory !== false) {
      try {
        const inventory = await api<InventoryRow[]>(
          `/inventory?branchId=${branchId}&page=1&pageSize=10&search=${encodeURIComponent(product.sku)}`,
        );
        const row = inventory.find((entry) => entry.productId === item.productId);
        availableQuantity = row?.quantity ?? 0;
      } catch {
        availableQuantity = null;
      }
    }

    return {
      productId: item.productId,
      requiredQuantity: item.requiredQuantity || 1,
      role: item.role || 'combo_component',
      id: item.productId,
      name: item.productName || product.name,
      sku: item.sku || product.sku,
      unit: product.unit,
      unitKind: product.unitKind,
      defaultStep: product.defaultStep,
      trackInventory: product.trackInventory,
      sellingPrice: product.sellingPrice,
      taxRate: product.taxRate ?? '0.00',
      isTaxInclusive: product.isTaxInclusive ?? true,
      status: product.status,
      categoryName: product.categoryName,
      availableQuantity,
    };
  } catch {
    return null;
  }
}

async function fetchCombosViaPromotionsApi(
  branchId: string,
  search?: string,
): Promise<PosComboPromotion[]> {
  const list = await api<PromotionSummary[]>(
    `/promotions?page=1&pageSize=100${
      search ? `&search=${encodeURIComponent(search)}` : ''
    }`,
  );

  const activeCombos = list.filter(
    (promo) => promo.isActive && promo.type === 'combo_bundle' && Boolean(promo.comboPrice),
  );

  const results: PosComboPromotion[] = [];
  for (const promo of activeCombos) {
    const detail = await api<PromotionDetail>(`/promotions/${promo.id}`);
    const components = (
      await Promise.all((detail.items ?? []).map((item) => enrichComponent(item, branchId)))
    ).filter((component): component is PosComboComponent => Boolean(component));

    if (!components.length) continue;

    results.push({
      id: promo.id,
      name: promo.name,
      code: promo.code,
      type: 'combo_bundle',
      comboPrice: promo.comboPrice!,
      description: promo.description,
      components,
    });
  }

  return results;
}

/** Load sellable combo bundles for POS. Prefers dedicated endpoints, falls back to promotions CRUD. */
export async function fetchPosCombos(
  branchId: string,
  search?: string,
): Promise<PosComboPromotion[]> {
  const query = search ? `&search=${encodeURIComponent(search)}` : '';

  try {
    return await api<PosComboPromotion[]>(`/pos/promotions?branchId=${branchId}${query}`);
  } catch (error) {
    if (!isMissingRoute(error)) {
      // Continue — older APIs may not expose /pos/promotions yet.
    }
  }

  try {
    return await api<PosComboPromotion[]>(
      `/promotions/pos-catalog?branchId=${branchId}${query}`,
    );
  } catch (error) {
    if (!isMissingRoute(error)) {
      // Continue to list/detail composition.
    }
  }

  return fetchCombosViaPromotionsApi(branchId, search);
}
