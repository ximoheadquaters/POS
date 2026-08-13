import pg from 'pg';
import type { AppConfig } from '../config.js';
import type { Database, Queryable } from './types.js';

const { Pool } = pg;

export class PostgresDatabase implements Database {
  private readonly pool: pg.Pool;

  constructor(config: Pick<AppConfig, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_POOL_MAX'>) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      // Supabase's session pool has a small project-wide connection budget.
      // A single API instance must not reserve the entire pool because Render,
      // local development, migrations, and the website API may connect at the
      // same time. Queries above this limit queue inside pg.Pool.
      max: config.DATABASE_POOL_MAX,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
  }

  query<T extends pg.QueryResultRow>(text: string, values?: readonly unknown[]) {
    return this.pool.query<T>(text, values as unknown[]);
  }

  async transaction<T>(work: (transaction: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
