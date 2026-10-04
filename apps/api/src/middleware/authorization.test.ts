import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import { createApp } from '../app.js';
import { AuthorizationDatabase, result, testUser } from '../test/fakes.js';

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
  resendOwnerInvitation: async () => undefined,
  getUser: async () => null,
  deleteUser: async () => undefined,
};

class ProductCreationDatabase extends AuthorizationDatabase {
  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (text.includes('exists(select 1 from product_units')) {
      return result([{ unitValid: true, categoryValid: true, brandValid: true } as unknown as T]);
    }
    if (text.includes('insert into products')) {
      this.calls.push(values ? { text, values } : { text });
      return result([
        {
          id: '55555555-5555-4555-8555-555555555555',
          name: values?.[4],
          sku: values?.[5],
          sellingPrice: values?.[12],
          taxRate: values?.[13],
          isTaxInclusive: values?.[14],
          status: values?.[15],
        } as unknown as T,
      ]);
    }
    if (text.includes('insert into inventory_movements')) {
      this.calls.push(values ? { text, values } : { text });
      return result([{ id: '66666666-6666-4666-8666-666666666666' } as unknown as T]);
    }
    return super.query<T>(text, values);
  }
}

class RoleManagementDatabase extends AuthorizationDatabase {
  constructor(
    user = testUser({
      role: 'owner',
      permissions: ['users:read', 'users:manage'],
    }),
    private readonly managedRole: 'owner' | 'cashier' = 'cashier',
  ) {
    super(user);
  }

  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (text.includes('count(distinct pr.id)::int as "userCount"')) {
      return result([
        {
          id: '77777777-7777-4777-8777-777777777777',
          code: 'cashier',
          name: 'Cashier',
          isSystem: true,
          userCount: 2,
          permissions: ['sales:create', 'products:read'],
        } as unknown as T,
      ]);
    }
    if (text === 'select code,description from permissions order by code') {
      return result([
        { code: 'products:read', description: 'View products' } as unknown as T,
        { code: 'sales:create', description: 'Complete sales' } as unknown as T,
      ]);
    }
    if (text.includes('select code,name from roles')) {
      return result([
        {
          code: this.managedRole,
          name: this.managedRole === 'owner' ? 'Owner' : 'Cashier',
        } as unknown as T,
      ]);
    }
    if (text.includes('insert into role_permissions')) {
      const inserted = result<T>([]);
      inserted.rowCount = (values?.[1] as string[]).length;
      return inserted;
    }
    return super.query<T>(text, values);
  }
}

class PromotionToggleDatabase extends AuthorizationDatabase {
  readonly promotionId = '88888888-8888-4888-8888-888888888888';
  readonly promotionBranchId = '22222222-2222-4222-8222-222222222222';
  readonly otherBranchId = '33333333-3333-4333-8333-333333333333';

  constructor() {
    super(
      testUser({
        modules: ['products', 'pos', 'promotions'],
        permissions: ['promotions:read', 'promotions:manage'],
        branches: [
          { id: '22222222-2222-4222-8222-222222222222', name: 'Main', code: 'MAIN' },
          { id: '33333333-3333-4333-8333-333333333333', name: 'Second', code: 'SECOND' },
        ],
      }),
    );
  }

  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (text.includes('update promotions set is_active')) {
      this.calls.push(values ? { text, values } : { text });
      return result(
        values?.[2] === this.promotionBranchId
          ? ([{ id: this.promotionId, isActive: false }] as unknown as T[])
          : [],
      );
    }
    return super.query<T>(text, values);
  }
}

class PromotionUpdateDatabase extends AuthorizationDatabase {
  readonly promotionId = '88888888-8888-4888-8888-888888888888';
  readonly branchId = '22222222-2222-4222-8222-222222222222';
  readonly retainedProductId = '55555555-5555-4555-8555-555555555555';

  constructor() {
    super(
      testUser({
        modules: ['products', 'pos', 'promotions'],
        permissions: ['promotions:read', 'promotions:manage'],
      }),
    );
  }

  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (text.includes('select id,branch_id as "branchId" from promotions')) {
      this.calls.push(values ? { text, values } : { text });
      return result([{ id: this.promotionId, branchId: this.branchId } as unknown as T]);
    }
    if (
      text.includes('update promotions set') ||
      text.includes('delete from promotion_items') ||
      text.includes('insert into promotion_items')
    ) {
      this.calls.push(values ? { text, values } : { text });
      return result([]);
    }
    if (text.includes('select 1 from products') && text.includes('union all')) {
      this.calls.push(values ? { text, values } : { text });
      return result([{ existingComponent: true } as unknown as T]);
    }
    return super.query<T>(text, values);
  }
}

describe('API authorization boundaries', () => {
  it('derives organization scope from the authenticated profile', async () => {
    const database = new AuthorizationDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });
    const response = await request(app)
      .get(`/api/v1/products?page=1&pageSize=20&branchId=${database.user.branches[0]!.id}`)
      .set('authorization', 'Bearer valid-token')
      .expect(200);
    expect(response.body.data[0].name).toBe('Tenant A Product');
    const productCall = database.calls.find((call) => call.text.includes('from products p'));
    expect(productCall?.values?.[0]).toBe(database.user.organization.id);
    expect(productCall?.values?.[4]).toBe(database.user.branches[0]!.id);
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

  it('rejects inventory availability requests for an unassigned branch', async () => {
    const database = new AuthorizationDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    const response = await request(app)
      .get('/api/v1/products?branchId=99999999-9999-4999-8999-999999999999')
      .set('authorization', 'Bearer valid-token')
      .expect(403);

    expect(response.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  it('limits the POS catalog to tracked products stocked at the selected branch', async () => {
    const database = new AuthorizationDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    await request(app)
      .get(`/api/v1/products?usage=pos&branchId=${database.user.branches[0]!.id}`)
      .set('authorization', 'Bearer valid-token')
      .expect(200);

    const productCall = database.calls.find(
      (call) => call.text.includes('from products p') && call.values?.includes('pos'),
    );
    expect(productCall?.text).toContain("$8::text is distinct from 'pos'");
    expect(productCall?.text).toContain('branch_stock.quantity>0');
  });

  it('matches POS catalogue barcodes when the search is contained anywhere in the code', async () => {
    const database = new AuthorizationDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    await request(app)
      .get(`/api/v1/products?usage=pos&branchId=${database.user.branches[0]!.id}&search=099`)
      .set('authorization', 'Bearer valid-token')
      .expect(200);

    const productCall = database.calls.find(
      (call) => call.text.includes('from products p') && call.values?.includes('099'),
    );
    expect(productCall?.text).toContain("pb.barcode ilike '%'||$2||'%'");
  });

  it('allows an existing combo component to remain while another item is removed', async () => {
    const database = new PromotionUpdateDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    await request(app)
      .put(`/api/v1/promotions/${database.promotionId}`)
      .set('authorization', 'Bearer valid-token')
      .send({
        branchId: database.branchId,
        name: 'Updated combo',
        type: 'combo_bundle',
        comboPrice: '50.00',
        isActive: true,
        items: [
          {
            productId: database.retainedProductId,
            role: 'combo_component',
            requiredQuantity: 1,
          },
        ],
      })
      .expect(200);

    const validationIndex = database.calls.findIndex((call) => call.text.includes('union all'));
    const deleteIndex = database.calls.findIndex((call) =>
      call.text.includes('delete from promotion_items'),
    );
    expect(validationIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(validationIndex);
    expect(database.calls[validationIndex]?.values?.[3]).toBe(database.promotionId);
  });

  it('toggles a promotion only in the explicitly selected branch', async () => {
    const database = new PromotionToggleDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    await request(app)
      .post(`/api/v1/promotions/${database.promotionId}/toggle`)
      .set('authorization', 'Bearer valid-token')
      .send({ branchId: database.promotionBranchId })
      .expect(200);

    const toggleCall = database.calls.find((call) =>
      call.text.includes('update promotions set is_active'),
    );
    expect(toggleCall?.text).toContain('branch_id = $3');
    expect(toggleCall?.values).toEqual([
      database.promotionId,
      database.user.organization.id,
      database.promotionBranchId,
    ]);

    await request(app)
      .post(`/api/v1/promotions/${database.promotionId}/toggle`)
      .set('authorization', 'Bearer valid-token')
      .send({ branchId: database.otherBranchId })
      .expect(404);
  });

  it('requires promotion manage permission for promotion changes', async () => {
    const database = new AuthorizationDatabase(testUser({
      modules: ['pos', 'promotions'],
      permissions: ['promotions:read'],
    }));
    const app = createApp({ database, verifyToken: async () => ({ id: database.user.id, email: database.user.email }), authActions });

    await request(app)
      .post('/api/v1/promotions/88888888-8888-4888-8888-888888888888/toggle')
      .set('authorization', 'Bearer valid-token')
      .send({ branchId: database.user.branches[0]!.id })
      .expect(403);
    expect(database.calls.some((call) => call.text.includes('update promotions set is_active'))).toBe(false);
  });

  it('lets a cashier load active discount rules without browsing the promotion catalog', async () => {
    const database = new AuthorizationDatabase(testUser({
      modules: ['pos', 'promotions'],
      permissions: ['sales:create'],
    }));
    const app = createApp({ database, verifyToken: async () => ({ id: database.user.id, email: database.user.email }), authActions });
    const branchId = database.user.branches[0]!.id;

    await request(app)
      .get(`/api/v1/promotions/active-rules?branchId=${branchId}`)
      .set('authorization', 'Bearer valid-token')
      .expect(200);
    await request(app)
      .get(`/api/v1/promotions?branchId=${branchId}`)
      .set('authorization', 'Bearer valid-token')
      .expect(403);
  });

  it('prevents cashiers from assigning another cashier to a shift', async () => {
    const database = new AuthorizationDatabase(testUser({
      modules: ['pos'],
      permissions: ['shifts:open'],
    }));
    const app = createApp({ database, verifyToken: async () => ({ id: database.user.id, email: database.user.email }), authActions });

    await request(app)
      .post('/api/v1/registers/shifts/open')
      .set('authorization', 'Bearer valid-token')
      .send({
        branchId: database.user.branches[0]!.id,
        registerId: '33333333-3333-4333-8333-333333333333',
        startingCash: '0.00',
        cashierId: '55555555-5555-4555-8555-555555555555',
      })
      .expect(403);
    expect(database.calls.some((call) => call.text.includes('insert into register_shifts'))).toBe(false);
  });

  it('uses transfer permissions instead of inventory adjustment for transfers', async () => {
    const database = new AuthorizationDatabase(testUser({
      modules: ['stock_transfers'],
      permissions: ['transfers:read'],
    }));
    const app = createApp({ database, verifyToken: async () => ({ id: database.user.id, email: database.user.email }), authActions });
    const branchId = database.user.branches[0]!.id;

    await request(app)
      .get(`/api/v1/stock-transfers?branchId=${branchId}`)
      .set('authorization', 'Bearer valid-token')
      .expect(200);
    await request(app)
      .post('/api/v1/stock-transfers/88888888-8888-4888-8888-888888888888/receive')
      .set('authorization', 'Bearer valid-token')
      .expect(403);
  });

  it('allows register staff to view only their own shift history without reports access', async () => {
    const database = new AuthorizationDatabase(testUser({
      modules: ['pos'],
      permissions: ['registers:read', 'shifts:open'],
    }));
    const app = createApp({ database, verifyToken: async () => ({ id: database.user.id, email: database.user.email }), authActions });
    const branchId = database.user.branches[0]!.id;

    await request(app)
      .get(`/api/v1/reports/shifts?branchId=${branchId}&from=2026-10-01T00:00:00.000Z&to=2026-10-02T00:00:00.000Z`)
      .set('authorization', 'Bearer valid-token')
      .expect(200);
    const shiftQuery = database.calls.find((call) => call.text.includes('from register_shifts rs'));
    expect(shiftQuery?.text).toContain('rs.cashier_id=$9::uuid');
    expect(shiftQuery?.values).toContain(database.user.id);
  });

  it('limits combo promotions to branches with enough component stock', async () => {
    const database = new AuthorizationDatabase(
      testUser({ modules: ['products', 'pos', 'promotions'] }),
    );
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    await request(app)
      .get(`/api/v1/pos/promotions?branchId=${database.user.branches[0]!.id}`)
      .set('authorization', 'Bearer valid-token')
      .expect(200);

    const comboCall = database.calls.find((call) => call.text.includes('from promotions p'));
    expect(comboCall?.values?.[1]).toBe(database.user.branches[0]!.id);
    expect(comboCall?.text).toContain('coalesce(stock.quantity, 0) < stock_item.required_quantity');
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

  it('creates a scanned product and opening inventory in one transaction', async () => {
    const database = new ProductCreationDatabase(
      testUser({
        role: 'owner',
        permissions: ['products:read', 'products:manage'],
        modules: ['products'],
      }),
    );
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });
    const response = await request(app)
      .post('/api/v1/products')
      .set('authorization', 'Bearer valid-token')
      .send({
        branchId: database.user.branches[0]!.id,
        openingQuantity: 12,
        name: 'Scanned coffee',
        sku: '4800012345678',
        barcode: '4800012345678',
        cost: '5.00',
        sellingPrice: '7.00',
        taxRate: '0.00',
        isTaxInclusive: false,
        status: 'active',
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      name: 'Scanned coffee',
      sku: '4800012345678',
      barcodes: ['4800012345678'],
    });
    expect(database.calls.some((call) => call.text.includes('insert into branch_inventory'))).toBe(
      true,
    );
    expect(
      database.calls.some(
        (call) =>
          call.text.includes('insert into inventory_movements') && call.values?.includes(12),
      ),
    ).toBe(true);
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

  it('prevents a manager from assigning an employee to an inaccessible branch', async () => {
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
        displayName: 'Remote Cashier',
        email: 'remote.cashier@example.com',
        temporaryPassword: 'temporary-1234',
        role: 'cashier',
        branchIds: ['99999999-9999-4999-8999-999999999999'],
      })
      .expect(403);

    expect(response.body.error.code).toBe('BRANCH_ASSIGNMENT_DENIED');
  });

  it('returns the role and permission access matrix', async () => {
    const database = new RoleManagementDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    const response = await request(app)
      .get('/api/v1/users/roles')
      .set('authorization', 'Bearer valid-token')
      .expect(200);

    expect(response.body.data.roles[0]).toMatchObject({
      code: 'cashier',
      editable: true,
      userCount: 2,
    });
    expect(response.body.data.permissions).toHaveLength(2);
  });

  it('allows an owner to update employee role permissions', async () => {
    const database = new RoleManagementDatabase();
    const app = createApp({
      database,
      verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
      authActions,
    });

    const response = await request(app)
      .patch('/api/v1/users/roles/77777777-7777-4777-8777-777777777777')
      .set('authorization', 'Bearer valid-token')
      .send({ permissions: ['products:read', 'sales:create'] })
      .expect(200);

    expect(response.body.data).toMatchObject({
      code: 'cashier',
      permissions: ['products:read', 'sales:create'],
    });
    expect(database.calls.some((call) => call.text.includes('delete from role_permissions'))).toBe(
      true,
    );
  });

  it('prevents managers from changing role permissions', async () => {
    const database = new RoleManagementDatabase(
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
      .patch('/api/v1/users/roles/77777777-7777-4777-8777-777777777777')
      .set('authorization', 'Bearer valid-token')
      .send({ permissions: ['products:read'] })
      .expect(403);

    expect(response.body.error.code).toBe('ROLE_PERMISSION_MANAGEMENT_DENIED');
  });
});
