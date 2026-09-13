import type { Request, Response } from 'express';
import type { QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { authenticate, CONTEXT_SQL } from './auth.js';
import { AuthorizationDatabase } from '../test/fakes.js';

class SubscriptionDatabase extends AuthorizationDatabase {
  constructor(private readonly endsAt: string | null) {
    super();
  }
  override async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    const response = await super.query<T>(text, values);
    if (text === CONTEXT_SQL) {
      response.rows = response.rows.map((row) => ({ ...row, current_period_ends_at: this.endsAt }));
    }
    return response;
  }
}
describe('SaaS subscription expiry', () => {
  it.each([
    ['2000-01-01T00:00:00Z', true],
    ['2999-01-01T00:00:00Z', false],
    [null, false],
  ] as const)('checks the paid-through date %s', async (endsAt, expired) => {
    const database = new SubscriptionDatabase(endsAt);
    const middleware = authenticate(database, async () => ({
      id: database.user.id,
      email: database.user.email,
    }));
    const next = vi.fn();
    await middleware({ header: () => 'Bearer test' } as unknown as Request, {} as Response, next);
    if (expired)
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_EXPIRED' }));
    else expect(next).toHaveBeenCalledWith();
  });
});
