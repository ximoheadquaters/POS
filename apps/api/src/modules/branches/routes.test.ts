import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import { createApp } from '../../app.js';
import { AuthorizationDatabase, result, testUser } from '../../test/fakes.js';

const authActions = {
  login: async () => ({}),
  resetPassword: async () => undefined,
  createUser: async (input: { email: string }) => ({ id: 'new-user', email: input.email }),
  inviteUser: async (input: { email: string }) => ({ id: 'invited-user', email: input.email }),
  resendOwnerInvitation: async () => undefined,
  getUser: async () => null,
  deleteUser: async () => undefined,
};

const MAIN_BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_BRANCH_ID = '33333333-3333-4333-8333-333333333333';

class BranchDatabase extends AuthorizationDatabase {
  branches = [
    {
      id: MAIN_BRANCH_ID,
      name: 'Main Branch',
      code: 'MAIN',
      address: 'Main Street',
      phone: null as string | null,
      isActive: true,
      staffCount: 2,
      inventoryItems: 20,
      registerCount: 1,
      openShiftCount: 0,
    },
    {
      id: SECOND_BRANCH_ID,
      name: 'Second Branch',
      code: 'SECOND',
      address: null as string | null,
      phone: null as string | null,
      isActive: true,
      staffCount: 0,
      inventoryItems: 0,
      registerCount: 0,
      openShiftCount: 0,
    },
  ];

  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (text.includes('from branches b where b.organization_id=$1')) {
      this.calls.push(values ? { text, values } : { text });
      return result(this.branches.map((branch) => ({ ...branch }) as unknown as T));
    }
    if (text === 'select id from branches where organization_id=$1 and code=$2') {
      this.calls.push(values ? { text, values } : { text });
      return result(
        this.branches
          .filter((branch) => branch.code === values?.[1])
          .map((branch) => ({ id: branch.id }) as unknown as T),
      );
    }
    if (text.includes('insert into branches (organization_id,name,code,address,phone,is_active)')) {
      this.calls.push(values ? { text, values } : { text });
      const branch = {
        id: '44444444-4444-4444-8444-444444444444',
        name: String(values?.[1]),
        code: String(values?.[2]),
        address: (values?.[3] as string | null) ?? null,
        phone: (values?.[4] as string | null) ?? null,
        isActive: Boolean(values?.[5]),
        staffCount: 0,
        inventoryItems: 0,
        registerCount: 0,
        openShiftCount: 0,
      };
      this.branches.push(branch);
      return result([{ ...branch } as unknown as T]);
    }
    if (text.includes('from branches where id=$1 and organization_id=$2 for update')) {
      this.calls.push(values ? { text, values } : { text });
      const branch = this.branches.find((item) => item.id === values?.[0]);
      return result(branch ? ([{ ...branch }] as unknown as T[]) : []);
    }
    if (text.includes('count(*)::int as count from branches')) {
      this.calls.push(values ? { text, values } : { text });
      const count = this.branches.filter(
        (branch) => branch.id !== values?.[1] && branch.isActive,
      ).length;
      return result([{ count } as unknown as T]);
    }
    if (text.includes('count(*)::int as count from register_shifts')) {
      this.calls.push(values ? { text, values } : { text });
      const branch = this.branches.find((item) => item.id === values?.[1]);
      return result([{ count: branch?.openShiftCount ?? 0 } as unknown as T]);
    }
    if (text.includes('update branches set name=')) {
      this.calls.push(values ? { text, values } : { text });
      const branch = this.branches.find((item) => item.id === values?.[0])!;
      Object.assign(branch, {
        name: String(values?.[2]),
        code: String(values?.[3]),
        address: (values?.[4] as string | null) ?? null,
        phone: (values?.[5] as string | null) ?? null,
        isActive: Boolean(values?.[6]),
      });
      return result([{ ...branch } as unknown as T]);
    }
    if (text.includes('insert into audit_logs')) {
      this.calls.push(values ? { text, values } : { text });
      return result([]);
    }
    return super.query<T>(text, values);
  }
}

function appFor(database: BranchDatabase) {
  return createApp({
    database,
    verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
    authActions,
  });
}

function ownerDatabase() {
  return new BranchDatabase(
    testUser({
      role: 'owner',
      permissions: ['branches:read', 'branches:manage'],
      branches: [
        { id: MAIN_BRANCH_ID, name: 'Main Branch', code: 'MAIN' },
        { id: SECOND_BRANCH_ID, name: 'Second Branch', code: 'SECOND' },
      ],
    }),
  );
}

describe('branch management', () => {
  it('returns tenant branches with operational counts', async () => {
    const database = ownerDatabase();
    const response = await request(appFor(database))
      .get('/api/v1/branches')
      .set('authorization', 'Bearer valid-token')
      .expect(200);

    expect(response.body.data[0]).toMatchObject({
      name: 'Main Branch',
      staffCount: 2,
      inventoryItems: 20,
      registerCount: 1,
    });
    const listCall = database.calls.find((call) =>
      call.text.includes('from branches b where b.organization_id=$1'),
    );
    expect(listCall?.values).toEqual([database.user.organization.id]);
  });

  it('creates and audits a branch inside the authenticated organization', async () => {
    const database = ownerDatabase();
    const response = await request(appFor(database))
      .post('/api/v1/branches')
      .set('authorization', 'Bearer valid-token')
      .send({
        name: 'North Branch',
        code: 'NORTH',
        address: 'North Road',
        phone: '09170000000',
        isActive: true,
      })
      .expect(201);

    expect(response.body.data).toMatchObject({ name: 'North Branch', code: 'NORTH' });
    expect(
      database.calls.some(
        (call) =>
          call.text.includes('insert into audit_logs') &&
          call.values?.[0] === database.user.organization.id,
      ),
    ).toBe(true);
  });

  it('does not allow the last active branch to be deactivated', async () => {
    const database = ownerDatabase();
    database.branches[1]!.isActive = false;
    const response = await request(appFor(database))
      .patch(`/api/v1/branches/${MAIN_BRANCH_ID}`)
      .set('authorization', 'Bearer valid-token')
      .send({ isActive: false })
      .expect(409);

    expect(response.body.error.code).toBe('LAST_ACTIVE_BRANCH');
    expect(database.branches[0]!.isActive).toBe(true);
  });

  it('keeps an inactive branch inactive when editing only its details', async () => {
    const database = ownerDatabase();
    database.branches[1]!.isActive = false;
    const response = await request(appFor(database))
      .patch(`/api/v1/branches/${SECOND_BRANCH_ID}`)
      .set('authorization', 'Bearer valid-token')
      .send({ name: 'Renamed Branch' })
      .expect(200);

    expect(response.body.data).toMatchObject({ name: 'Renamed Branch', isActive: false });
  });

  it('does not deactivate a branch with an open cashier shift', async () => {
    const database = ownerDatabase();
    database.branches[0]!.openShiftCount = 1;
    const response = await request(appFor(database))
      .patch(`/api/v1/branches/${MAIN_BRANCH_ID}`)
      .set('authorization', 'Bearer valid-token')
      .send({ isActive: false })
      .expect(409);

    expect(response.body.error.code).toBe('BRANCH_HAS_OPEN_SHIFTS');
    expect(database.branches[0]!.isActive).toBe(true);
  });
});
