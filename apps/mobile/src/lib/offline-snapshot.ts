import { appStorage } from './storage';

const SNAPSHOT_PREFIX = 'ximo.offline-snapshot.v1.';

export interface OfflineSnapshot {
  branchId: string;
  syncedAt: string;
  products: unknown[];
  posProducts?: unknown[];
  inventory: unknown[];
  customers: unknown[];
  categories: unknown[];
  brands: unknown[];
  units: unknown[];
  registers: unknown[];
  settings: unknown;
}

export async function saveOfflineSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  await appStorage.setItem(`${SNAPSHOT_PREFIX}${snapshot.branchId}`, JSON.stringify(snapshot));
  await appStorage.setItem(`${SNAPSHOT_PREFIX}active`, snapshot.branchId);
}

export async function getOfflineSnapshot(branchId?: string): Promise<OfflineSnapshot | null> {
  const selected = branchId ?? (await appStorage.getItem(`${SNAPSHOT_PREFIX}active`));
  if (!selected) return null;
  const stored = await appStorage.getItem(`${SNAPSHOT_PREFIX}${selected}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as OfflineSnapshot;
  } catch {
    await appStorage.removeItem(`${SNAPSHOT_PREFIX}${selected}`);
    return null;
  }
}

function page<T>(items: T[], parameters: URLSearchParams): T[] {
  const pageNumber = Math.max(1, Number(parameters.get('page') ?? 1));
  const pageSize = Math.max(1, Number(parameters.get('pageSize') ?? 20));
  const start = (pageNumber - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function searchable(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const value = item as Record<string, unknown>;
  return [value.name, value.sku, value.phone, value.email]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
}

function roleCounts(items: unknown[]) {
  const counts = {
    all: items.length,
    sellable: 0,
    ingredient: 0,
    both: 0,
    enabled: 0,
    disabled: 0,
  };
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { inventoryRole?: string; status?: string };
    const role = row.inventoryRole ?? 'sellable';
    if (role === 'ingredient') counts.ingredient += 1;
    else if (role === 'both') counts.both += 1;
    else counts.sellable += 1;
    if (row.status === 'inactive') counts.disabled += 1;
    else counts.enabled += 1;
  }
  return counts;
}

function parseCsvParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function offlineSnapshotFallback<T>(path: string): Promise<T | undefined> {
  const [pathname, rawQuery = ''] = path.split('?');
  const parameters = new URLSearchParams(rawQuery);
  const snapshot = await getOfflineSnapshot(parameters.get('branchId') ?? undefined);
  if (!snapshot) return undefined;
  const search = (parameters.get('search') ?? '').trim().toLowerCase();
  const usage = parameters.get('usage');
  const inventoryRoles = parseCsvParam(parameters.get('inventoryRole'));
  const statuses = parseCsvParam(parameters.get('status'));
  const includeInactive = parameters.get('includeInactive') === 'true';
  const filtered = (items: unknown[]) =>
    items.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (search && !searchable(item).includes(search)) return false;
      const row = item as { inventoryRole?: string; status?: string; trackInventory?: boolean };
      const role = row.inventoryRole ?? 'sellable';
      const status = row.status ?? 'active';

      if (statuses.length > 0) {
        if (!statuses.includes(status)) return false;
      } else if (!includeInactive && status === 'inactive') {
        return false;
      }

      if (inventoryRoles.length > 0 && !inventoryRoles.includes(role)) return false;
      if (usage === 'pos') return role === 'sellable' || role === 'both';
      if (usage === 'bom') return Boolean(row.trackInventory);
      return true;
    });
  if (pathname === '/products/summary') return roleCounts(snapshot.products) as T;
  if (pathname === '/inventory/summary') return roleCounts(snapshot.inventory) as T;
  if (pathname === '/products') {
    const products = usage === 'pos' ? (snapshot.posProducts ?? snapshot.products) : snapshot.products;
    return page(filtered(products), parameters) as T;
  }
  if (pathname === '/inventory') return page(filtered(snapshot.inventory), parameters) as T;
  if (pathname === '/customers') return page(filtered(snapshot.customers), parameters) as T;
  if (pathname === '/categories') return snapshot.categories as T;
  if (pathname === '/brands') return snapshot.brands as T;
  if (pathname === '/product-units') return snapshot.units as T;
  if (pathname === '/registers') return snapshot.registers as T;
  if (pathname === '/settings') return snapshot.settings as T;
  if (pathname === '/products/lookup') {
    const code = parameters.get('code');
    const products = usage === 'pos' ? (snapshot.posProducts ?? snapshot.products) : snapshot.products;
    return filtered(products).find((item) => {
      const product = item as {
        sku?: string;
        barcodes?: string[];
        sellingUnits?: Array<{ sku?: string; barcodes?: string[] }>;
      };
      return (
        product.sku === code ||
        product.barcodes?.includes(code ?? '') ||
        product.sellingUnits?.some(
          (unit) => unit.sku === code || unit.barcodes?.includes(code ?? ''),
        )
      );
    }) as T;
  }
  return undefined;
}
