import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

interface ActiveShift {
  id: string;
  registerId: string;
  registerName: string;
  branchId: string;
}

interface ShiftState {
  activeShift: ActiveShift | null;
  hydrated: boolean;
  hydrate(): Promise<void>;
  setActive(shift: ActiveShift): Promise<void>;
  clear(): Promise<void>;
}

const key = 'ximo.active-shift';

export const useShiftStore = create<ShiftState>((set) => ({
  activeShift: null,
  hydrated: false,
  async hydrate() {
    const stored = await SecureStore.getItemAsync(key);
    set({ activeShift: stored ? (JSON.parse(stored) as ActiveShift) : null, hydrated: true });
  },
  async setActive(shift) {
    await SecureStore.setItemAsync(key, JSON.stringify(shift));
    set({ activeShift: shift });
  },
  async clear() {
    await SecureStore.deleteItemAsync(key);
    set({ activeShift: null });
  },
}));
