import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AuthorizationDatabase, testUser } from '../test/fakes.js';

const authActions = {
  login: async () => ({}),
  resetPassword: async () => undefined,
  createUser: async (input: { email: string }) => ({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    email: input.email,
  }),
  inviteUser: async (input: { email: string }) => ({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    email: input.email,
  }),
  deleteUser: async () => undefined,
};

describe('API authorization boundaries', () => {
  it('derives organization scope from the authenticated profile', async () => {
    const database = new AuthorizationDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });
    const response = await request(app)
      .get('/api/v1/products?page=1&pageSize=20')
      .set('authorization', 'Bearer valid-token')
      .expect(200);
    expect(response.body.data[0].name).toBe('Tenant A Product');
    const productCall = database.calls.find((call) => call.text.includes('from products p'));
    expect(productCall?.values?.[0]).toBe(database.user.organization.id);
    expect(productCall?.values).not.toContain('99999999-9999-4999-8999-999999999999');
  });

  it('rejects a cashier accessing an unassigned branch', async () => {
    const database = new AuthorizationDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });
    const response = await request(app)
      .post('/api/v1/sales/checkout')
      .set('authorization', 'Bearer valid-token')
      .set('idempotency-key', 'unique-checkout-key')
      .send({
        branchId: '99999999-9999-4999-8999-999999999999',
        registerId: '33333333-3333-4333-8333-333333333333',
        shiftId: '44444444-4444-4444-8444-444444444444',
        items: [{ productId: '55555555-5555-4555-8555-555555555555', quantity: 1 }],
        payments: [{ method: 'cash', amount: '15.00' }],
      })
      .expect(403);
    expect(response.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  it('rejects routes for disabled modules', async () => {
    const database = new AuthorizationDatabase(
      testUser({ modules: ['pos'], permissions: ['products:read'] }),
    );
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });
    const response = await request(app)
      .get('/api/v1/products')
      .set('authorization', 'Bearer valid-token')
      .expect(403);
    expect(response.body.error.code).toBe('MODULE_DISABLED');
  });

  it('allows an owner to create a cashier linked to an assigned branch', async () => {
    const database = new AuthorizationDatabase(
      testUser({
        role: 'owner',
        permissions: ['users:read', 'users:manage'],
      }),
    );
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });
    const response = await request(app)
      .post('/api/v1/users')
      .set('authorization', 'Bearer valid-token')
      .send({
        displayName: 'New Cashier',
        email: 'new.cashier@example.com',
        temporaryPassword: 'temporary-1234',
        role: 'cashier',
        branchIds: [database.user.branches[0]!.id],
      })
      .expect(201);
    expect(response.body.data).toMatchObject({
      displayName: 'New Cashier',
      email: 'new.cashier@example.com',
      role: 'cashier',
      isActive: true,
    });
    expect(response.body.data.branches).toHaveLength(1);
  });

  it('prevents a manager from creating another manager', async () => {
    const database = new AuthorizationDatabase(
      testUser({
        role: 'manager',
        permissions: ['users:read', 'users:manage'],
      }),
    );
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });
    const response = await request(app)
      .post('/api/v1/users')
      .set('authorization', 'Bearer valid-token')
      .send({
        displayName: 'Unauthorized Manager',
        email: 'manager.two@example.com',
        temporaryPassword: 'temporary-1234',
        role: 'manager',
        branchIds: [database.user.branches[0]!.id],
      })
      .expect(403);
    expect(response.body.error.code).toBe('ROLE_MANAGEMENT_DENIED');
  });
});
