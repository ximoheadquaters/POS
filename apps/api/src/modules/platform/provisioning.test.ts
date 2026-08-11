import type { QueryResultRow } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import type { AuthActions } from '../../auth/types.js';
import type { Database } from '../../database/types.js';
import { createPlatformToken } from '../../platform/token.js';
import { conflict, serviceUnavailable } from '../../shared/errors.js';
import { result } from '../../test/fakes.js';

const API_CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BRANCH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface StoredIdempotency {
  requestHash: string;
  responseData: Record<string, unknown> | null;
}

class ProvisioningDatabase implements Database {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  public readonly organizations = new Map<string, Record<string, unknown>>();
  public readonly profileEmails = new Set<string>();
  public idempotency = new Map<string, StoredIdempotency>();
  public planActive = true;
  public planAvailable = true;
  public failOrganizationInsert = false;

  constructor(private readonly tokenHash: string) {}

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });

    if (text.includes('update platform_api_clients')) {
      return result(
        values?.[0] === this.tokenHash
          ? [
              {
                id: API_CLIENT_ID,
                name: 'Main website',
                scopes: ['platform:read', 'platform:write'],
              } as unknown as T,
            ]
          : [],
      );
    }
    if (text.includes('p.billing_interval as "billingInterval"')) {
      return result([
        {
          code: 'business',
          name: 'Business',
          description: 'Business plan',
          priceMonthly: '999.00',
          billingInterval: 'monthly',
          isActive: this.planActive,
          isAvailableForOnboarding: this.planAvailable,
          allowedOnboardingStatuses: ['trialing', 'active'],
          modules: [
            { code: 'inventory', name: 'Inventory' },
            { code: 'pos', name: 'Point of Sale' },
          ],
        } as unknown as T,
      ]);
    }
    if (text.includes('insert into platform_idempotency_keys')) {
      const key = `${values?.[0]}:${values?.[1]}`;
      if (this.idempotency.has(key)) return result([]);
      this.idempotency.set(key, {
        requestHash: values?.[2] as string,
        responseData: null,
      });
      return result([{ idempotency_key: values?.[1] } as unknown as T]);
    }
    if (text.includes('from platform_idempotency_keys') && text.includes('response_data')) {
      const stored = this.idempotency.get(`${values?.[0]}:${values?.[1]}`);
      return result(
        stored
          ? [
              {
                requestHash: stored.requestHash,
                responseData: stored.responseData,
              } as unknown as T,
            ]
          : [],
      );
    }
    if (text.includes('p.is_available_for_onboarding as "isAvailableForOnboarding"')) {
      if (values?.[0] !== 'business') return result([]);
      return result([
        {
          id: PLAN_ID,
          applicationId: '99999999-9999-4999-8999-999999999999',
          code: 'business',
          name: 'Business',
          isActive: this.planActive,
          isAvailableForOnboarding: this.planAvailable,
          allowedOnboardingStatuses: ['trialing', 'active'],
          modules: [
            { code: 'inventory', name: 'Inventory' },
            { code: 'pos', name: 'Point of Sale' },
          ],
        } as unknown as T,
      ]);
    }
    if (text.includes('select 1 from profiles where lower(email)')) {
      return result(
        this.profileEmails.has(String(values?.[0]).toLowerCase())
          ? [{ exists: 1 } as unknown as T]
          : [],
      );
    }
    if (text.includes('insert into organizations')) {
      if (this.failOrganizationInsert) throw new Error('simulated database failure');
      const organization = {
        id: values?.[0],
        name: values?.[1],
        currency: values?.[3],
        timezone: values?.[4],
        businessProfile: values?.[5] ?? 'retail',
      };
      this.organizations.set(String(values?.[0]), organization);
      return result([organization as unknown as T]);
    }
    if (text.includes('insert into roles')) {
      return result(
        ['owner', 'administrator', 'manager', 'cashier', 'inventory_staff'].map(
          (code, index) =>
            ({
              id: `00000000-0000-4000-8000-00000000000${index + 1}`,
              code,
            }) as unknown as T,
        ),
      );
    }
    if (text.includes('insert into profiles')) {
      this.profileEmails.add(String(values?.[4]).toLowerCase());
      return result([]);
    }
    if (text.includes('insert into branches')) {
      return result([
        {
          id: BRANCH_ID,
          name: 'Main Branch',
          code: 'MAIN',
        } as unknown as T,
      ]);
    }
    if (text.includes('update platform_idempotency_keys')) {
      const key = `${values?.[0]}:${values?.[1]}`;
      const stored = this.idempotency.get(key)!;
      stored.responseData = JSON.parse(String(values?.[2])) as Record<string, unknown>;
      return result([]);
    }
    if (text === 'select 1') return result([{ '?column?': 1 } as unknown as T]);
    return result([]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    const organizations = structuredClone(this.organizations);
    const profileEmails = structuredClone(this.profileEmails);
    const idempotency = structuredClone(this.idempotency);
    try {
      return await work(this);
    } catch (error) {
      this.organizations.clear();
      for (const [key, value] of organizations) this.organizations.set(key, value);
      this.profileEmails.clear();
      for (const email of profileEmails) this.profileEmails.add(email);
      this.idempotency = idempotency;
      throw error;
    }
  }

  async close() {}
}

function authFixture(
  options: { failInvite?: boolean; duplicateAuth?: boolean; existingUser?: boolean } = {},
) {
  const invitations: string[] = [];
  const deletions: string[] = [];
  const actions: AuthActions = {
    login: async () => ({}),
    resetPassword: async () => undefined,
    createUser: async (input) => ({ id: OWNER_ID, email: input.email }),
    inviteUser: async (input) => {
      invitations.push(input.email);
      if (options.duplicateAuth) {
        throw conflict('OWNER_ALREADY_EXISTS', 'Owner already exists');
      }
      if (options.failInvite) {
        throw serviceUnavailable('OWNER_INVITATION_UNAVAILABLE', 'Invitation service unavailable');
      }
      return { id: OWNER_ID, email: input.email };
    },
    resendOwnerInvitation: async () => undefined,
    getUser: async (userId) =>
      options.existingUser && userId === OWNER_ID
        ? {
            id: OWNER_ID,
            email: requestBody.ownerEmail,
            createdAt: '2026-08-10T00:00:00.000Z',
            invitedAt: null,
            lastSignInAt: '2026-08-10T00:05:00.000Z',
          }
        : null,
    deleteUser: async (userId) => {
      deletions.push(userId);
    },
  };
  return { actions, invitations, deletions };
}

function createProvisioningApp(database: ProvisioningDatabase, authActions: AuthActions) {
  return createApp({
    database,
    authActions,
    verifyToken: async () => ({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      email: 'pos@example.com',
    }),
  });
}

const requestBody = {
  name: 'New Client Business',
  currency: 'PHP',
  timezone: 'Asia/Manila',
  planCode: 'business',
  subscriptionStatus: 'active',
  ownerEmail: 'owner@example.com',
  ownerName: 'Client Owner',
};

describe('Platform organization provisioning', () => {
  it('lists onboarding plans and module objects from the database', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const response = await request(createProvisioningApp(database, authFixture().actions))
      .get('/api/v1/platform/plans')
      .set('authorization', `Bearer ${token.token}`)
      .expect(200);

    expect(response.body.data[0]).toMatchObject({
      code: 'business',
      billingInterval: 'monthly',
      isAvailableForOnboarding: true,
      allowedOnboardingStatuses: ['trialing', 'active'],
      modules: [
        { code: 'inventory', name: 'Inventory' },
        { code: 'pos', name: 'Point of Sale' },
      ],
    });
  });

  it('provisions a complete organization with plan-default modules', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const auth = authFixture();
    const response = await request(createProvisioningApp(database, auth.actions))
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1001')
      .send(requestBody)
      .expect(201);

    expect(response.body.data).toMatchObject({
      name: requestBody.name,
      currency: 'PHP',
      timezone: 'Asia/Manila',
      planCode: 'business',
      planName: 'Business',
      subscriptionStatus: 'active',
      enabledModules: [
        { code: 'inventory', name: 'Inventory', source: 'plan' },
        { code: 'pos', name: 'Point of Sale', source: 'plan' },
      ],
      owner: {
        email: requestBody.ownerEmail,
        displayName: requestBody.ownerName,
        invitationStatus: 'pending',
      },
      defaultBranch: { id: BRANCH_ID, name: 'Main Branch', code: 'MAIN' },
    });
    expect(auth.invitations).toEqual([requestBody.ownerEmail]);
    expect(
      database.calls.some((call) => call.text.includes('insert into organization_modules')),
    ).toBe(false);
    expect(database.organizations.size).toBe(1);
  });

  it('rejects unavailable plans and disallowed onboarding statuses with 422', async () => {
    const token = createPlatformToken();
    const inactiveDatabase = new ProvisioningDatabase(token.tokenHash);
    inactiveDatabase.planActive = false;
    const inactivePlan = await request(
      createProvisioningApp(inactiveDatabase, authFixture().actions),
    )
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1002')
      .send(requestBody)
      .expect(422);
    expect(inactivePlan.body.error.code).toBe('INVALID_PLAN');

    const statusDatabase = new ProvisioningDatabase(token.tokenHash);
    const invalidStatus = await request(
      createProvisioningApp(statusDatabase, authFixture().actions),
    )
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1003')
      .send({ ...requestBody, subscriptionStatus: 'past_due' })
      .expect(422);
    expect(invalidStatus.body.error.code).toBe('INVALID_SUBSCRIPTION_STATUS');
  });

  it('rejects duplicate POS owners without sending an invitation', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    database.profileEmails.add(requestBody.ownerEmail);
    const auth = authFixture();
    const response = await request(createProvisioningApp(database, auth.actions))
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1004')
      .send(requestBody)
      .expect(409);

    expect(response.body.error.code).toBe('OWNER_ALREADY_EXISTS');
    expect(auth.invitations).toHaveLength(0);
  });

  it('handles an owner that already exists in Supabase Auth', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const auth = authFixture({ duplicateAuth: true });
    const response = await request(createProvisioningApp(database, auth.actions))
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1008')
      .send(requestBody)
      .expect(409);

    expect(response.body.error.code).toBe('OWNER_ALREADY_EXISTS');
    expect(database.organizations.size).toBe(0);
    expect(database.idempotency.size).toBe(0);
  });

  it('links a website-authenticated owner instead of sending another invitation', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const auth = authFixture({ existingUser: true });
    const response = await request(createProvisioningApp(database, auth.actions))
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-existing-owner-1001')
      .send({ ...requestBody, ownerUserId: OWNER_ID })
      .expect(201);

    expect(response.body.data.owner).toMatchObject({
      email: requestBody.ownerEmail,
      invitationStatus: 'accepted',
    });
    expect(auth.invitations).toHaveLength(0);
    const profileInsert = database.calls.find((call) => call.text.includes('insert into profiles'));
    expect(profileInsert?.values?.[0]).toBe(OWNER_ID);
  });

  it('distinguishes malformed requests from invalid domain values', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const app = createProvisioningApp(database, authFixture().actions);

    const malformed = await request(app)
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1009')
      .send({ ...requestBody, ownerEmail: undefined })
      .expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');

    const invalid = await request(app)
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1010')
      .send({
        ...requestBody,
        currency: 'ZZZ',
        timezone: 'Not/A_Timezone',
        ownerEmail: 'not-an-email',
      })
      .expect(422);
    expect(invalid.body.error).toMatchObject({
      code: 'INVALID_ORGANIZATION_PROVISIONING',
      details: {
        currency: expect.any(String),
        timezone: expect.any(String),
        ownerEmail: expect.any(String),
      },
    });
  });

  it('requires an idempotency key before provisioning', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const response = await request(createProvisioningApp(database, authFixture().actions))
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .send(requestBody)
      .expect(400);

    expect(response.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('rolls back database state and revokes the invitation after a database failure', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    database.failOrganizationInsert = true;
    const auth = authFixture();
    await request(createProvisioningApp(database, auth.actions))
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1005')
      .send(requestBody)
      .expect(500);

    expect(auth.invitations).toEqual([requestBody.ownerEmail]);
    expect(auth.deletions).toEqual([OWNER_ID]);
    expect(database.organizations.size).toBe(0);
    expect(database.idempotency.size).toBe(0);
  });

  it('replays the original response and rejects a changed request using the same key', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const auth = authFixture();
    const app = createProvisioningApp(database, auth.actions);
    const first = await request(app)
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1006')
      .send(requestBody)
      .expect(201);
    const replay = await request(app)
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1006')
      .send(requestBody)
      .expect(200);

    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data).toEqual(first.body.data);
    expect(auth.invitations).toHaveLength(1);

    const conflictResponse = await request(app)
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1006')
      .send({ ...requestBody, name: 'Changed Business Name' })
      .expect(409);
    expect(conflictResponse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('returns 503 and rolls back when the invitation dependency is unavailable', async () => {
    const token = createPlatformToken();
    const database = new ProvisioningDatabase(token.tokenHash);
    const auth = authFixture({ failInvite: true });
    const response = await request(createProvisioningApp(database, auth.actions))
      .post('/api/v1/platform/organizations')
      .set('authorization', `Bearer ${token.token}`)
      .set('idempotency-key', 'website-order-1007')
      .send(requestBody)
      .expect(503);

    expect(response.body.error.code).toBe('OWNER_INVITATION_UNAVAILABLE');
    expect(database.idempotency.size).toBe(0);
  });
});
