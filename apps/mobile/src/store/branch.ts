import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

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
    const value = await SecureStore.getItemAsync(storageKey);
    set({ activeBranch: value ? (JSON.parse(value) as Branch) : null, hydrated: true });
  },
  async select(branch) {
    await SecureStore.setItemAsync(storageKey, JSON.stringify(branch));
    set({ activeBranch: branch });
  },
  async clear() {
    await SecureStore.deleteItemAsync(storageKey);
    set({ activeBranch: null });
  },
}));
