import { create } from 'zustand';
import { appStorage } from '@/lib/storage';

export interface ActiveShift {
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
    const stored = await appStorage.getItem(key);
    set({ activeShift: stored ? (JSON.parse(stored) as ActiveShift) : null, hydrated: true });
  },
  async setActive(shift) {
    await appStorage.setItem(key, JSON.stringify(shift));
    set({ activeShift: shift });
  },
  async clear() {
    await appStorage.removeItem(key);
    set({ activeShift: null });
  },
}));
