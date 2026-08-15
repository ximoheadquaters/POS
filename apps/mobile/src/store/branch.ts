import { create } from 'zustand';
import { appStorage } from '@/lib/storage';

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface BranchState {
  activeBranch: Branch | null;
  hydrated: boolean;
  hydrate(): Promise<void>;
  select(branch: Branch): Promise<void>;
  reconcile(branches: Branch[]): Promise<Branch | null>;
  clear(): Promise<void>;
}

const storageKey = 'ximo.active-branch';

export const useBranchStore = create<BranchState>((set, get) => ({
  activeBranch: null,
  hydrated: false,
  async hydrate() {
    const value = await appStorage.getItem(storageKey);
    set({ activeBranch: value ? (JSON.parse(value) as Branch) : null, hydrated: true });
  },
  async select(branch) {
    await appStorage.setItem(storageKey, JSON.stringify(branch));
    set({ activeBranch: branch });
  },
  async reconcile(branches) {
    const current = get().activeBranch;
    const next = current
      ? branches.find((branch) => branch.id === current.id) ?? branches[0] ?? null
      : branches[0] ?? null;

    if (!next) {
      await appStorage.removeItem(storageKey);
      set({ activeBranch: null });
      return null;
    }

    // Persist the server-authorized branch object as well as its ID. This
    // removes stale branch selections after a database, organization, or user
    // change and refreshes renamed branch details kept by the app.
    await appStorage.setItem(storageKey, JSON.stringify(next));
    set({ activeBranch: next });
    return next;
  },
  async clear() {
    await appStorage.removeItem(storageKey);
    set({ activeBranch: null });
  },
}));
