import type { QueryResultRow } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import type { AuthActions } from '../../auth/types.js';
import type { Database } from '../../database/types.js';
import { createPlatformToken } from '../../platform/token.js';
import { serviceUnavailable } from '../../shared/errors.js';
import { result } from '../../test/fakes.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const API_CLIENT_ID = '33333333-3333-4333-8333-333333333333';

class OwnerInvitationDatabase implements Database {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  public invitationSentAt: string | null = new Date(Date.now() - 600_000).toISOString();

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
                id: API_CLIENT_ID,
                name: 'Main website',
                scopes: this.scopes,
              } as unknown as T,
            ]
          : [],
      );
    }
    if (text === 'select id from organizations where id=$1 for update') {
      return result(
        values?.[0] === ORGANIZATION_ID ? [{ id: ORGANIZATION_ID } as unknown as T] : [],
      );
    }
    if (text.includes("r.code='owner'") && text.includes('for update of p')) {
      return result([
        {
          id: OWNER_ID,
          email: 'owner@example.com',
          displayName: 'Client Owner',
          createdAt: '2026-07-20T00:00:00.000Z',
          invitationSentAt: this.invitationSentAt,
        } as unknown as T,
      ]);
    }
    if (text.startsWith('update profiles')) {
      this.invitationSentAt = String(values?.[1]);
      return result([]);
    }
    if (text.includes('insert into platform_audit_logs')) return result([]);
    if (text.includes('from organizations o') && text.includes('"branchCount"')) {
      return result([
        {
          id: ORGANIZATION_ID,
          name: 'Client Business',
          currency: 'PHP',
          timezone: 'Asia/Manila',
          planCode: 'business',
          planName: 'Business',
          subscriptionStatus: 'active',
          branchCount: 1,
          userCount: 1,
        } as unknown as T,
      ]);
    }
    if (text.includes("r.code='owner'") && !text.includes('for update of p')) {
      return result([
        {
          id: OWNER_ID,
          email: 'owner@example.com',
          displayName: 'Client Owner',
          createdAt: '2026-07-20T00:00:00.000Z',
          invitationSentAt: this.invitationSentAt,
        } as unknown as T,
      ]);
    }
    if (text === 'select 1') return result([{ '?column?': 1 } as unknown as T]);
    return result([]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    const invitationSentAt = this.invitationSentAt;
    try {
      return await work(this);
    } catch (error) {
      this.invitationSentAt = invitationSentAt;
      throw error;
    }
  }

  async close() {}
}

function authFixture(options: { providerFailure?: boolean } = {}) {
  const resends: string[] = [];
  const actions: AuthActions = {
    login: async () => ({}),
    resetPassword: async () => undefined,
    createUser: async (input) => ({ id: OWNER_ID, email: input.email }),
    inviteUser: async (input) => ({ id: OWNER_ID, email: input.email }),
    resendOwnerInvitation: async (email) => {
      if (options.providerFailure) {
        throw serviceUnavailable(
          'OWNER_INVITATION_UNAVAILABLE',
          'The owner invitation service is temporarily unavailable',
        );
      }
      resends.push(email);
    },
    getUser: async () => ({
      id: OWNER_ID,
      email: 'owner@example.com',
      createdAt: '2026-07-20T00:00:00.000Z',
      invitedAt: '2026-07-20T00:01:00.000Z',
      lastSignInAt: null,
    }),
    deleteUser: async () => undefined,
  };
  return { actions, resends };
}

function app(database: OwnerInvitationDatabase, authActions: AuthActions) {
  return createApp({
    database,
    authActions,
    verifyToken: async () => ({ id: OWNER_ID, email: 'owner@example.com' }),
  });
}

describe('Platform owner invitations', () => {
  it('requires Platform authentication and platform:write scope', async () => {
    const token = createPlatformToken();
    const auth = authFixture();
    await request(app(new OwnerInvitationDatabase(token.tokenHash), auth.actions))
      .post(`/api/v1/platform/organizations/${ORGANIZATION_ID}/owner-invitation/resend`)
      .expect(401);

    const readonly = new OwnerInvitationDatabase(token.tokenHash, ['platform:read']);
    const response = await request(app(readonly, auth.actions))
      .post(`/api/v1/platform/organizations/${ORGANIZATION_ID}/owner-invitation/resend`)
      .set('authorization', `Bearer ${token.token}`)
      .expect(403);
    expect(response.body.error.code).toBe('PLATFORM_SCOPE_REQUIRED');
  });

  it('returns 404 for an unknown organization', async () => {
    const token = createPlatformToken();
    const auth = authFixture();
    const response = await request(app(new OwnerInvitationDatabase(token.tokenHash), auth.actions))
      .post(
        '/api/v1/platform/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/owner-invitation/resend',
      )
      .set('authorization', `Bearer ${token.token}`)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(auth.resends).toHaveLength(0);
  });

  it('validates the organization UUID before attempting a resend', async () => {
    const token = createPlatformToken();
    const auth = authFixture();
    const response = await request(app(new OwnerInvitationDatabase(token.tokenHash), auth.actions))
      .post('/api/v1/platform/organizations/not-a-uuid/owner-invitation/resend')
      .set('authorization', `Bearer ${token.token}`)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(auth.resends).toHaveLength(0);
  });

  it('sends a recovery invitation, updates its timestamp, and writes an audit record', async () => {
    const token = createPlatformToken();
    const database = new OwnerInvitationDatabase(token.tokenHash);
    const auth = authFixture();
    const response = await request(app(database, auth.actions))
      .post(`/api/v1/platform/organizations/${ORGANIZATION_ID}/owner-invitation/resend`)
      .set('authorization', `Bearer ${token.token}`)
      .set('x-platform-actor-id', 'super-admin-1')
      .expect(202);

    expect(response.body.data).toMatchObject({
      accepted: true,
      organizationId: ORGANIZATION_ID,
      owner: {
        email: 'owner@example.com',
        displayName: 'Client Owner',
        invitationStatus: 'pending',
      },
    });
    expect(auth.resends).toEqual(['owner@example.com']);
    expect(
      database.calls.some(
        (call) =>
          call.text.includes('insert into platform_audit_logs') &&
          call.text.includes('organization.owner_invitation.resent'),
      ),
    ).toBe(true);
  });

  it('returns a safe provider error without changing invitation state', async () => {
    const token = createPlatformToken();
    const database = new OwnerInvitationDatabase(token.tokenHash);
    const before = database.invitationSentAt;
    const response = await request(app(database, authFixture({ providerFailure: true }).actions))
      .post(`/api/v1/platform/organizations/${ORGANIZATION_ID}/owner-invitation/resend`)
      .set('authorization', `Bearer ${token.token}`)
      .expect(503);

    expect(response.body.error.code).toBe('OWNER_INVITATION_UNAVAILABLE');
    expect(database.invitationSentAt).toBe(before);
  });

  it('rate limits repeated resend requests for the same owner', async () => {
    const token = createPlatformToken();
    const database = new OwnerInvitationDatabase(token.tokenHash);
    database.invitationSentAt = new Date().toISOString();
    const auth = authFixture();
    const response = await request(app(database, auth.actions))
      .post(`/api/v1/platform/organizations/${ORGANIZATION_ID}/owner-invitation/resend`)
      .set('authorization', `Bearer ${token.token}`)
      .expect(429);

    expect(response.body.error).toMatchObject({
      code: 'OWNER_INVITATION_RATE_LIMITED',
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(auth.resends).toHaveLength(0);
  });

  it('returns safe invitation metadata with organization details', async () => {
    const token = createPlatformToken();
    const database = new OwnerInvitationDatabase(token.tokenHash);
    const response = await request(app(database, authFixture().actions))
      .get(`/api/v1/platform/organizations/${ORGANIZATION_ID}`)
      .set('authorization', `Bearer ${token.token}`)
      .expect(200);

    expect(response.body.data.owner).toEqual({
      email: 'owner@example.com',
      displayName: 'Client Owner',
      invitationStatus: 'pending',
      invitedAt: '2026-07-20T00:01:00.000Z',
      createdAt: '2026-07-20T00:00:00.000Z',
      lastSignInAt: null,
    });
  });
});
