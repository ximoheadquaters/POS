import type { CurrentUser } from '@ximo/shared';
import { appStorage } from './storage';

const CACHE_PREFIX = 'ximo.current-user.v1.';
const LEGACY_AUTH_CURRENT_PATH = '/auth/current';

interface CachedCurrentUser {
  userId: string;
  cachedAt: string;
  user: CurrentUser;
}

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`;
}

function legacyCacheKey(): string {
  let hash = 5381;
  for (let index = 0; index < LEGACY_AUTH_CURRENT_PATH.length; index += 1) {
    hash = (hash * 33) ^ LEGACY_AUTH_CURRENT_PATH.charCodeAt(index);
  }
  return `ximo.api-cache.${(hash >>> 0).toString(36)}`;
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<CurrentUser>;
  const organization = user.organization;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.displayName === 'string' &&
    typeof user.role === 'string' &&
    Array.isArray(user.permissions) &&
    Array.isArray(user.modules) &&
    Array.isArray(user.branches) &&
    organization !== undefined &&
    typeof organization.id === 'string' &&
    typeof organization.name === 'string'
  );
}

async function getStored(key: string): Promise<string | null> {
  try {
    return await appStorage.getItem(key);
  } catch {
    return null;
  }
}

async function discard(key: string): Promise<void> {
  await appStorage.removeItem(key).catch(() => undefined);
}

export async function cacheCurrentUser(user: CurrentUser): Promise<void> {
  await appStorage.setItem(
    cacheKey(user.id),
    JSON.stringify({
      userId: user.id,
      cachedAt: new Date().toISOString(),
      user,
    } satisfies CachedCurrentUser),
  );
}

/**
 * Returns only the context saved for the currently authenticated account.
 * Never use a path-scoped API cache here: that could show another account's
 * organization and permissions after a shared-device sign-in.
 */
export async function getCachedCurrentUser(userId: string): Promise<CurrentUser | null> {
  const key = cacheKey(userId);
  const stored = await getStored(key);
  if (stored) {
    try {
      const cached = JSON.parse(stored) as CachedCurrentUser;
      if (cached.userId === userId && cached.user?.id === userId && isCurrentUser(cached.user)) {
        return cached.user;
      }
    } catch {
      // Discard below.
    }
    await discard(key);
  }

  // Earlier app versions stored this endpoint by URL only. Migrate it only
  // when the saved identity is the authenticated user requesting it.
  const oldKey = legacyCacheKey();
  const legacyStored = await getStored(oldKey);
  if (!legacyStored) return null;
  try {
    const legacy = JSON.parse(legacyStored) as { data?: unknown };
    if (isCurrentUser(legacy.data) && legacy.data.id === userId) {
      void cacheCurrentUser(legacy.data).catch(() => undefined);
      await discard(oldKey);
      return legacy.data;
    }
  } catch {
    // Discard below.
  }
  await discard(oldKey);
  return null;
}

export async function clearCachedCurrentUser(userId: string | undefined): Promise<void> {
  if (!userId) return;
  await appStorage.removeItem(cacheKey(userId));
}
