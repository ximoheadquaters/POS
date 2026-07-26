import type { CurrentUser } from '@ximo/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../database/types.js';

export function result<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

export function testUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'cashier@example.com',
    displayName: 'Demo Cashier',
    organization: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Organization A',
      currency: 'PHP',
      timezone: 'Asia/Manila',
      subscriptionStatus: 'active',
    },
    role: 'cashier',
    permissions: ['products:read', 'sales:create', 'sales:read_branch'],
    modules: ['products', 'pos'],
    branches: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Authorized Branch',
        code: 'AUTH',
      },
    ],
    ...overrides,
  };
}

export class AuthorizationDatabase implements Database {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  constructor(public user = testUser()) {}

  async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    this.calls.push(values ? { text, values } : { text });
    if (text.includes('from profiles p') && text.includes('organization_name')) {
      const user = this.user;
      return result([
        {
          id: user.id,
          email: user.email,
          display_name: user.displayName,
          organization_id: user.organization.id,
          organization_name: user.organization.name,
          currency: user.organization.currency,
          timezone: user.organization.timezone,
          subscription_status: user.organization.subscriptionStatus,
          role: user.role,
          permissions: user.permissions,
          modules: user.modules,
          branches: user.branches,
        } as unknown as T,
      ]);
    }
    if (text.includes('from products p')) {
      return result([
        {
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Tenant A Product',
          sku: 'A-001',
          cost: '10.00',
          sellingPrice: '15.00',
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
