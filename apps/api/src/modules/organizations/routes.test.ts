import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import { createApp } from '../../app.js';
import type { AssetStorage } from '../../storage/assets.js';
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

class OrganizationDatabase extends AuthorizationDatabase {
  organization = {
    id: this.user.organization.id,
    name: this.user.organization.name,
    slug: 'organization-a',
    currency: this.user.organization.currency,
    timezone: this.user.organization.timezone,
    logoPath: null as string | null,
  };

  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (text.includes('o.created_at as "createdAt"') && text.includes('from organizations o')) {
      this.calls.push(values ? { text, values } : { text });
      return result([
        {
          ...this.organization,
          createdAt: '2026-01-01T00:00:00.000Z',
          subscriptionStatus: 'active',
          planCode: 'growth',
          planName: 'Growth',
          branchCount: 1,
          activeBranchCount: 1,
          userCount: 2,
          activeUserCount: 2,
          branches: this.user.branches.map((branch) => ({ ...branch, isActive: true })),
        } as unknown as T,
      ]);
    }
    if (text.includes('select id,name,slug,currency,timezone,logo_path')) {
      this.calls.push(values ? { text, values } : { text });
      return result([{ ...this.organization } as unknown as T]);
    }
    if (text.includes('update organizations set name=')) {
      this.calls.push(values ? { text, values } : { text });
      this.organization = {
        ...this.organization,
        name: String(values?.[1]),
        currency: String(values?.[2]),
        timezone: String(values?.[3]),
        logoPath: (values?.[4] as string | null) ?? null,
      };
      return result([{ ...this.organization } as unknown as T]);
    }
    if (
      text.includes('update organization_settings set business_name=') ||
      text.includes("'organization.updated'")
    ) {
      this.calls.push(values ? { text, values } : { text });
      return result([]);
    }
    return super.query<T>(text, values);
  }
}

function appFor(
  database: OrganizationDatabase,
  assetStorage: AssetStorage = {
    uploadOrganizationLogo: async () => 'https://assets.example.com/organization/logo.jpg',
  },
) {
  return createApp({
    database,
    verifyToken: async () => ({ id: database.user.id, email: database.user.email }),
    authActions,
    assetStorage,
  });
}

describe('organization self-service', () => {
  it('returns only the authenticated tenant organization', async () => {
    const database = new OrganizationDatabase(
      testUser({
        role: 'owner',
        permissions: ['organization:read'],
      }),
    );
    const response = await request(appFor(database))
      .get('/api/v1/organizations/current')
      .set('authorization', 'Bearer valid-token')
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: database.user.organization.id,
      planCode: 'growth',
      activeBranchCount: 1,
    });
    const organizationCall = database.calls.find((call) =>
      call.text.includes('o.created_at as "createdAt"'),
    );
    expect(organizationCall?.values).toEqual([database.user.organization.id]);
  });

  it('requires organization:update permission', async () => {
    const database = new OrganizationDatabase(
      testUser({ role: 'cashier', permissions: ['organization:read'] }),
    );
    const response = await request(appFor(database))
      .put('/api/v1/organizations/current')
      .set('authorization', 'Bearer valid-token')
      .send({
        name: 'Blocked Update',
        currency: 'PHP',
        timezone: 'Asia/Manila',
        logoPath: null,
      })
      .expect(403);
    expect(response.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('updates and audits only the authenticated organization', async () => {
    const database = new OrganizationDatabase(
      testUser({
        role: 'owner',
        permissions: ['organization:read', 'organization:update'],
      }),
    );
    const response = await request(appFor(database))
      .put('/api/v1/organizations/current')
      .set('authorization', 'Bearer valid-token')
      .send({
        name: 'Updated Store Group',
        currency: 'PHP',
        timezone: 'Asia/Manila',
        logoPath: '/logos/store.png',
      })
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: database.user.organization.id,
      name: 'Updated Store Group',
      logoPath: '/logos/store.png',
    });
    const updateCall = database.calls.find((call) =>
      call.text.includes('update organizations set name='),
    );
    expect(updateCall?.values?.[0]).toBe(database.user.organization.id);
    expect(database.calls.some((call) => call.text.includes("'organization.updated'"))).toBe(true);
  });

  it('uploads an organization-scoped logo for an authorized owner', async () => {
    const database = new OrganizationDatabase(
      testUser({
        role: 'owner',
        permissions: ['organization:read', 'organization:update'],
      }),
    );
    const uploads: Array<{ organizationId: string; mimeType: string; bytes: Uint8Array }> = [];
    const response = await request(
      appFor(database, {
        async uploadOrganizationLogo(input) {
          uploads.push(input);
          return 'https://assets.example.com/organization/logo.jpg?v=1';
        },
      }),
    )
      .post('/api/v1/organizations/current/logo')
      .set('authorization', 'Bearer valid-token')
      .send({
        mimeType: 'image/jpeg',
        base64: Buffer.from('compressed-logo').toString('base64'),
      })
      .expect(200);

    expect(response.body.data.logoPath).toContain('/organization/logo.jpg');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      organizationId: database.user.organization.id,
      mimeType: 'image/jpeg',
    });
  });
});
