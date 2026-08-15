interface AppStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const nativeStorage: AppStorage = {
  async getItem(key) {
    const { default: storage } = await import('@react-native-async-storage/async-storage');
    return storage.getItem(key);
  },
  async setItem(key, value) {
    const { default: storage } = await import('@react-native-async-storage/async-storage');
    await storage.setItem(key, value);
  },
  async removeItem(key) {
    const { default: storage } = await import('@react-native-async-storage/async-storage');
    await storage.removeItem(key);
  },
};

const webStorage: AppStorage = {
  async getItem(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      if (!globalThis.localStorage) {
        throw new Error('Browser storage is unavailable in this window.');
      }
      globalThis.localStorage.setItem(key, value);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Browser storage is blocked or full.';
      throw new Error(`Could not save on this device: ${message}`);
    }
  },
  async removeItem(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Ignore storage removal failures.
    }
  },
};

const memory = new Map<string, string>();
const testStorage: AppStorage = {
  async getItem(key) {
    return memory.get(key) ?? null;
  },
  async setItem(key, value) {
    memory.set(key, value);
  },
  async removeItem(key) {
    memory.delete(key);
  },
};

export const appStorage =
  process.env.NODE_ENV === 'test'
    ? testStorage
    : typeof globalThis.localStorage !== 'undefined'
      ? webStorage
      : nativeStorage;
