import type { CurrentUser } from '@ximo/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storedValues = vi.hoisted(() => new Map<string, string>());

vi.mock('./storage', () => ({
  appStorage: {
    getItem: vi.fn(async (key: string) => storedValues.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storedValues.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storedValues.delete(key);
    }),
  },
}));

import { cacheCurrentUser, getCachedCurrentUser } from './current-user-cache';

const user = {
  id: 'user-a',
  email: 'owner@example.com',
  displayName: 'Owner',
  organization: {
    id: 'org-a',
    name: 'Store A',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    businessProfile: 'retail',
    subscriptionStatus: 'active',
  },
  role: 'owner',
  permissions: [],
  modules: [],
  branches: [],
} satisfies CurrentUser;

describe('current-user cache', () => {
  beforeEach(() => storedValues.clear());

  it('returns an offline context only to the account that saved it', async () => {
    await cacheCurrentUser(user);

    await expect(getCachedCurrentUser('user-a')).resolves.toEqual(user);
    await expect(getCachedCurrentUser('user-b')).resolves.toBeNull();
  });

  it('removes a malformed or mismatched context instead of using it', async () => {
    storedValues.set(
      'ximo.current-user.v1.user-a',
      JSON.stringify({ userId: 'user-b', user: { ...user, id: 'user-b' } }),
    );

    await expect(getCachedCurrentUser('user-a')).resolves.toBeNull();
    expect(storedValues.has('ximo.current-user.v1.user-a')).toBe(false);
  });

  it('safely migrates a matching legacy response cache', async () => {
    const path = '/auth/current';
    let hash = 5381;
    for (let index = 0; index < path.length; index += 1) {
      hash = (hash * 33) ^ path.charCodeAt(index);
    }
    const legacyKey = `ximo.api-cache.${(hash >>> 0).toString(36)}`;
    storedValues.set(legacyKey, JSON.stringify({ data: user }));

    await expect(getCachedCurrentUser('user-a')).resolves.toEqual(user);
    expect(storedValues.has(legacyKey)).toBe(false);
    expect(storedValues.has('ximo.current-user.v1.user-a')).toBe(true);
  });
});
