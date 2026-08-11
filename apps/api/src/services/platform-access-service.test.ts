import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Queryable } from '../database/types.js';
import { result } from '../test/fakes.js';
import { PlatformAccessService } from './platform-access-service.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('PlatformAccessService', () => {
  it('returns application-specific plan, role and entitlement context', async () => {
    const database: Queryable = {
      async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
        expect(text).toContain('from organization_memberships membership');
        expect(text).toContain('subscription.application_id = application.id');
        expect(values).toEqual([USER_ID, ORGANIZATION_ID]);
        return result<T>([
          {
            membershipId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            organizationId: ORGANIZATION_ID,
            membershipStatus: 'active',
            applications: [
              {
                id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                code: 'ximo_pos',
                name: 'Ximo POS',
                subscriptionStatus: 'active',
                planCode: 'business',
                planName: 'Business',
                role: 'owner',
                entitlements: { 'module.pos': true, branch_limit: 5 },
              },
            ],
          } as unknown as T,
        ]);
      },
    };

    const access = await new PlatformAccessService(database).getForUserOrganization(
      USER_ID,
      ORGANIZATION_ID,
    );

    expect(access.membership).toEqual({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      organizationId: ORGANIZATION_ID,
      status: 'active',
    });
    expect(access.applications[0]).toMatchObject({
      code: 'ximo_pos',
      planCode: 'business',
      role: 'owner',
      entitlements: { 'module.pos': true, branch_limit: 5 },
    });
  });

  it('returns an empty context when the user has no organization membership', async () => {
    const database: Queryable = {
      async query<T extends QueryResultRow>() {
        return result<T>([]);
      },
    };

    await expect(
      new PlatformAccessService(database).getForUserOrganization(USER_ID, ORGANIZATION_ID),
    ).resolves.toEqual({ applications: [] });
  });
});
