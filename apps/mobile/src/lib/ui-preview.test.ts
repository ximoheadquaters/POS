import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('UI preview mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('does not read browser location on Android, even when window exists', async () => {
    vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    vi.stubGlobal('window', {});

    const { isUiPreviewMode } = await import('./ui-preview');

    expect(isUiPreviewMode()).toBe(false);
  });
});
