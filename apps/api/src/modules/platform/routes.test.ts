import type { QueryResultRow } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import type { Database } from '../../database/types.js';
import { createPlatformToken, hashPlatformToken } from '../../platform/token.js';
import { result } from '../../test/fakes.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

class PlatformDatabase implements Database {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  public override: { enabled: boolean; reason: string } | null = null;
  public subscription: {
    planCode: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
  } = {
    planCode: 'starter',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEndsAt: '2027-01-01T00:00:00.000Z',
  };

  constructor(
    private readonly tokenHash: string,
    private readonly scopes: string[] = ['platform:read', 'platform:write'],
  ) {}

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });

    if (text.includes('update platform_api_clients')) {
      return result(
        values?.[0] === this.tokenHash
          ? [
              {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                name: 'Main website',
                scopes: this.scopes,
              } as unknown as T,
            ]
          : [],
      );
    }
    if (text === 'select id from organizations where id=$1') {
      return result(
        values?.[0] === ORGANIZATION_ID ? [{ id: ORGANIZATION_ID } as unknown as T] : [],
      );
    }
    if (text.includes('from organizations where id=$1 for update')) {
      return result(
        values?.[0] === ORGANIZATION_ID
          ? [
              {
                id: ORGANIZATION_ID,
                name: 'Main Store',
                slug: 'main-store',
                currency: 'PHP',
                timezone: 'Asia/Manila',
                logoPath: null,
                businessProfile: 'retail',
              } as unknown as T,
            ]
          : [],
      );
    }
    if (text.includes('update organizations set business_profile=$2')) {
      return result([
        {
          id: ORGANIZATION_ID,
          name: 'Main Store',
          slug: 'main-store',
          currency: 'PHP',
          timezone: 'Asia/Manila',
          logoPath: null,
          businessProfile: values?.[1] as string,
        } as unknown as T,
      ]);
    }
    if (text === 'select id from plans where code=$1 and is_active') {
      return result(
        values?.[0] === 'business'
          ? [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } as unknown as T]
          : [],
      );
    }
    if (text.includes('from subscriptions s join plans p')) {
      return result([{ ...this.subscription } as unknown as T]);
    }
    if (text.includes('insert into subscriptions')) {
      this.subscription = {
        planCode: 'business',
        status: values?.[2] as string,
        trialEndsAt: (values?.[3] as string | null) ?? null,
        currentPeriodEndsAt: (values?.[4] as string | null) ?? null,
      };
      return result([
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          status: this.subscription.status,
          trialEndsAt: this.subscription.trialEndsAt,
          currentPeriodEndsAt: this.subscription.currentPeriodEndsAt,
        } as unknown as T,
      ]);
    }
    if (text === 'select id from modules where code=$1') {
      return result(
        values?.[0] === 'inventory' || values?.[0] === 'receipt_printer'
          ? [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as unknown as T]
          : [],
      );
    }
    if (text.includes('select enabled,reason from organization_modules')) {
      return result(this.override ? [{ ...this.override } as unknown as T] : []);
    }
    if (text.includes('insert into organization_modules')) {
      this.override = {
        enabled: values?.[2] as boolean,
        reason: values?.[3] as string,
      };
      return result([]);
    }
    if (text.includes('delete from organization_modules')) {
      const removed = this.override;
      this.override = null;
      return result(removed ? [{ ...removed } as unknown as T] : []);
    }
    if (text.includes('select m.code,m.name,m.description')) {
      const moduleCode = (values?.[1] as string | undefined) ?? 'inventory';
      const includedInPlan = moduleCode === 'inventory';
      return result([
        {
          code: moduleCode,
          name: moduleCode === 'inventory' ? 'Inventory' : 'Receipt Printer',
          description: null,
          includedInPlan,
          overrideEnabled: this.override?.enabled ?? null,
          overrideReason: this.override?.reason ?? null,
          effectiveEnabled: this.override?.enabled ?? includedInPlan,
        } as unknown as T,
      ]);
    }
    if (text.includes('insert into platform_audit_logs')) return result([]);
    if (text.includes('from organizations o') && text.includes('enabledModuleCount')) {
      return result([
        {
          id: ORGANIZATION_ID,
          name: 'Organization A',
          slug: 'organization-a',
          planCode: 'business',
          subscriptionStatus: 'active',
          enabledModuleCount: 8,
          total: 1,
        } as unknown as T,
      ]);
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
  createUser: async (input: { email: string }) => ({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    email: input.email,
  }),
  inviteUser: async (input: { email: string }) => ({
    id: '99999999-9999-4999-8999-999999999999',
    email: input.email,
  }),
  resendOwnerInvitation: async () => undefined,
  getUser: async () => null,
  deleteUser: async () => undefined,
};

function platformApp(database: PlatformDatabase) {
  return createApp({
    database,
    verifyToken: async () => ({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      email: 'pos@example.com',
    }),
    authActions,
  });
}

describe('Platform API', () => {
  it('rejects missing and ordinary Supabase bearer tokens', async () => {
    const generated = createPlatformToken();
    const database = new PlatformDatabase(generated.tokenHash);
    const app = platformApp(database);

    await request(app).get('/api/v1/platform/organizations').expect(401);
    const response = await request(app)
      .get('/api/v1/platform/organizations')
      .set('authorization', 'Bearer ordinary-supabase-token')
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('stores and compares only a token hash while listing organizations', async () => {
    const generated = createPlatformToken();
    const database = new PlatformDatabase(generated.tokenHash);
    const response = await request(platformApp(database))
      .get('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${generated.token}`)
      .expect(200);

    expect(response.body.data[0]).toMatchObject({
      id: ORGANIZATION_ID,
      planCode: 'business',
      enabledModuleCount: 8,
    });
    const authenticationCall = database.calls.find((call) =>
      call.text.includes('update platform_api_clients'),
    );
    expect(authenticationCall?.values?.[0]).toBe(hashPlatformToken(generated.token));
    expect(authenticationCall?.values).not.toContain(generated.token);
  });

  it('prevents a read-only API client from changing modules', async () => {
    const generated = createPlatformToken();
    const database = new PlatformDatabase(generated.tokenHash, ['platform:read']);
    const response = await request(platformApp(database))
      .put(`/api/v1/platform/organizations/${ORGANIZATION_ID}/modules/inventory`)
      .set('authorization', `Bearer ${generated.token}`)
      .send({ enabled: false, reason: 'Client subscription excludes inventory' })
      .expect(403);

    expect(response.body.error.code).toBe('PLATFORM_SCOPE_REQUIRED');
  });

  it('sets and removes a module override with immutable audit records', async () => {
    const generated = createPlatformToken();
    const database = new PlatformDatabase(generated.tokenHash);
    const app = platformApp(database);

    const update = await request(app)
      .put(`/api/v1/platform/organizations/${ORGANIZATION_ID}/modules/inventory`)
      .set('authorization', `Bearer ${generated.token}`)
      .set('x-platform-actor-id', 'super-admin-123')
      .set('x-platform-actor-email', 'admin@example.com')
      .send({ enabled: false, reason: 'Client subscription excludes inventory' })
      .expect(200);

    expect(update.body.data).toMatchObject({
      code: 'inventory',
      overrideEnabled: false,
      effectiveEnabled: false,
    });

    const auditCall = database.calls.find((call) =>
      call.text.includes('insert into platform_audit_logs'),
    );
    expect(String(auditCall?.values?.[4])).toContain('admin@example.com');

    const removed = await request(app)
      .delete(`/api/v1/platform/organizations/${ORGANIZATION_ID}/modules/inventory`)
      .set('authorization', `Bearer ${generated.token}`)
      .expect(200);

    expect(removed.body.data).toMatchObject({
      code: 'inventory',
      overrideEnabled: null,
      effectiveEnabled: true,
    });
  });

  it('allows a platform super-admin to update an organization business profile and audit the change', async () => {
    const generated = createPlatformToken();
    const database = new PlatformDatabase(generated.tokenHash, ['platform:read', 'platform:write']);
    const app = platformApp(database);

    const response = await request(app)
      .patch(`/api/v1/platform/organizations/${ORGANIZATION_ID}/profile`)
      .set('authorization', `Bearer ${generated.token}`)
      .set('x-platform-actor-id', 'super-admin-123')
      .send({ businessProfile: 'food_service' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: ORGANIZATION_ID,
      businessProfile: 'food_service',
    });

    const auditCall = database.calls.find((call) =>
      call.text.includes("'organization.business_profile.updated'"),
    );
    expect(auditCall).toBeDefined();
  });

  it('enables an optional hardware module that is not included in the plan', async () => {
    const generated = createPlatformToken();
    const database = new PlatformDatabase(generated.tokenHash);
    const response = await request(platformApp(database))
      .put(`/api/v1/platform/organizations/${ORGANIZATION_ID}/modules/receipt_printer`)
      .set('authorization', `Bearer ${generated.token}`)
      .send({ enabled: true, reason: 'Compatible printer installed at the client site' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      code: 'receipt_printer',
      includedInPlan: false,
      overrideEnabled: true,
      effectiveEnabled: true,
    });
  });

  it('updates a subscription without clearing omitted period dates', async () => {
    const generated = createPlatformToken();
    const database = new PlatformDatabase(generated.tokenHash);
    const response = await request(platformApp(database))
      .patch(`/api/v1/platform/organizations/${ORGANIZATION_ID}/subscription`)
      .set('authorization', `Bearer ${generated.token}`)
      .send({ planCode: 'business', status: 'active' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      planCode: 'business',
      status: 'active',
      currentPeriodEndsAt: '2027-01-01T00:00:00.000Z',
    });
  });
});
