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
  clear(): Promise<void>;
}

const storageKey = 'ximo.active-branch';

export const useBranchStore = create<BranchState>((set) => ({
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
  async clear() {
    await appStorage.removeItem(storageKey);
    set({ activeBranch: null });
  },
}));
