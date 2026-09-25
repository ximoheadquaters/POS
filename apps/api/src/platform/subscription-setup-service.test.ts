import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { Database } from '../database/types.js';
import { result } from '../test/fakes.js';
import { setupSubscriptionBranches } from './subscription-setup-service.js';

class SetupDatabase implements Database {
  codes = ['MAIN', 'SUB-2'];
  activeCount = 1;
  completed = false;
  created: string[] = [];
  grants = 0;
  async close() {}
  async query<T extends QueryResultRow>(sql: string, values?: readonly unknown[]) {
    if (sql.startsWith('select id from organizations')) return result([{ id: 'org' }] as unknown as T[]);
    if (sql.startsWith('select id from audit_logs')) return result((this.completed ? [{ id: 'audit' }] : []) as unknown as T[]);
    if (sql.includes('select p.id from profiles')) return result([{ id: 'owner' }] as unknown as T[]);
    if (sql.startsWith('select id from branches')) return result(Array.from({ length: this.activeCount }, (_, id) => ({ id: String(id) })) as unknown as T[]);
    if (sql.startsWith('select code from branches')) return result(this.codes.map(code => ({ code })) as unknown as T[]);
    if (sql.includes('insert into branches')) {
      const code = String(values?.[2]);
      this.created.push(code); this.codes.push(code); this.activeCount++;
      return result([{ id: code }] as unknown as T[]);
    }
    if (sql.includes('insert into user_branches')) this.grants++;
    if (sql.includes('insert into audit_logs')) this.completed = true;
    return result([] as T[]);
  }
  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> { return work(this); }
}

describe('paid branch setup', () => {
  it('creates the purchased number with owner access and avoids existing codes', async () => {
    const db = new SetupDatabase();
    expect(await setupSubscriptionBranches(db, 'org', 3, 'order')).toEqual({ branchCount: 3 });
    expect(db.created).toEqual(['SUB-3', 'SUB-4']);
    expect(db.grants).toBe(2);
  });
  it('does not recreate branches when a completed payment is retried after deactivation', async () => {
    const db = new SetupDatabase();
    await setupSubscriptionBranches(db, 'org', 3, 'order');
    db.activeCount = 1;
    await setupSubscriptionBranches(db, 'org', 3, 'order');
    expect(db.created).toHaveLength(2);
  });
});
