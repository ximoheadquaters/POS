import { describe, expect, it } from 'vitest';
import { togglePermission } from './access-control';

describe('permission dependencies', () => {
  it('adds read access when manage access is enabled', () => {
    expect(togglePermission([], 'users:manage')).toEqual(
      expect.arrayContaining(['users:read', 'users:manage']),
    );
  });

  it('removes dependent manage access when read access is removed', () => {
    expect(togglePermission(['products:read', 'products:manage'], 'products:read')).toEqual([]);
  });
});
