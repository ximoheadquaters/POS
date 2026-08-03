import type { QueryResultRow } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import type { Database } from '../../database/types.js';
import { result } from '../../test/fakes.js';

class AdminDatabase implements Database {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  constructor(
    private readonly platformAdmins: Record<string, { email: string; displayName: string; role: 'viewer' | 'admin' | 'super_admin'; isActive: boolean }> = {},
  ) {}

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });

    if (text.includes('from platform_admins')) {
      const adminId = String(values?.[0] ?? '');
      const admin = this.platformAdmins[adminId];
      if (admin && admin.isActive) {
        return result([
          {
            id: adminId,
            email: admin.email,
            display_name: admin.displayName,
            role: admin.role,
            is_active: admin.isActive,
          } as unknown as T,
        ]);
      }
      return result([]);
    }

    if (text === 'select 1') return result([{ '?column?': 1 } as unknown as T]);
    return result([]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    return work(this);
  }
  async close() {}
}

const authActions = {
  login: async () => ({}),
  resetPassword: async () => undefined,
  createUser: async (input: { email: string }) => ({ id: 'new-user', email: input.email }),
  inviteUser: async (input: { email: string }) => ({ id: 'invited-user', email: input.email }),
  resendOwnerInvitation: async () => undefined,
  getUser: async () => null,
  deleteUser: async () => undefined,
};

function adminApp(database: AdminDatabase) {
  return createApp({
    database,
    verifyToken: async (token) => {
      if (token === 'admin-jwt-token') {
        return { id: 'admin-user-id-123', email: 'admin@ximo.app' };
      }
      if (token === 'ordinary-org-jwt-token') {
        return { id: 'org-user-id-456', email: 'cashier@tenant.com' };
      }
      throw new Error('Invalid token');
    },
    authActions,
  });
}

describe('Platform Admin Session Flow', () => {
  it('rejects unauthenticated requests', async () => {
    const database = new AdminDatabase();
    const app = adminApp(database);

    const response = await request(app)
      .get('/api/v1/admin/current')
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects ordinary organization users who do not exist in platform_admins', async () => {
    const database = new AdminDatabase({
      // Only admin-user-id-123 exists, org-user-id-456 does NOT
    });
    const app = adminApp(database);

    const response = await request(app)
      .get('/api/v1/admin/current')
      .set('authorization', 'Bearer ordinary-org-jwt-token')
      .expect(403);

    expect(response.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  it('allows a platform admin without an organization profile to authenticate', async () => {
    const database = new AdminDatabase({
      'admin-user-id-123': {
        email: 'admin@ximo.app',
        displayName: 'Platform Super Admin',
        role: 'super_admin',
        isActive: true,
      },
    });
    const app = adminApp(database);

    const response = await request(app)
      .get('/api/v1/admin/current')
      .set('authorization', 'Bearer admin-jwt-token')
      .expect(200);

    expect(response.body.data).toEqual({
      id: 'admin-user-id-123',
      email: 'admin@ximo.app',
      displayName: 'Platform Super Admin',
      role: 'super_admin',
    });
  });
});
