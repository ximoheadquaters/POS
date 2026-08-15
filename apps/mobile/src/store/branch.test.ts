import { beforeEach, describe, expect, it, vi } from 'vitest';

const storedValues = vi.hoisted(() => new Map<string, string>());

vi.mock('@/lib/storage', () => ({
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

import { useBranchStore } from './branch';

const mainBranch = { id: 'branch-main', name: 'Main Branch', code: 'MAIN' };
const secondBranch = { id: 'branch-two', name: 'Second Branch', code: 'SECOND' };

describe('branch selection reconciliation', () => {
  beforeEach(() => {
    storedValues.clear();
    useBranchStore.setState({ activeBranch: null, hydrated: false });
  });

  it('replaces a stale stored branch with the first server-authorized branch', async () => {
    storedValues.set(
      'ximo.active-branch',
      JSON.stringify({ id: 'old-database-branch', name: 'Old Branch', code: 'OLD' }),
    );

    await useBranchStore.getState().hydrate();
    const selected = await useBranchStore.getState().reconcile([mainBranch, secondBranch]);

    expect(selected).toEqual(mainBranch);
    expect(useBranchStore.getState().activeBranch).toEqual(mainBranch);
    expect(JSON.parse(storedValues.get('ximo.active-branch') ?? 'null')).toEqual(mainBranch);
  });

  it('keeps an authorized selection while refreshing its stored branch details', async () => {
    useBranchStore.setState({
      activeBranch: { id: secondBranch.id, name: 'Old Name', code: 'OLD-CODE' },
      hydrated: true,
    });

    const selected = await useBranchStore.getState().reconcile([mainBranch, secondBranch]);

    expect(selected).toEqual(secondBranch);
    expect(useBranchStore.getState().activeBranch).toEqual(secondBranch);
  });

  it('clears the persisted branch when the user has no assigned branches', async () => {
    storedValues.set('ximo.active-branch', JSON.stringify(mainBranch));
    useBranchStore.setState({ activeBranch: mainBranch, hydrated: true });

    const selected = await useBranchStore.getState().reconcile([]);

    expect(selected).toBeNull();
    expect(useBranchStore.getState().activeBranch).toBeNull();
    expect(storedValues.has('ximo.active-branch')).toBe(false);
  });
});
