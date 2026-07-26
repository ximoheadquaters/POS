import pg from 'pg';
import type { AppConfig } from '../config.js';
import type { Database, Queryable } from './types.js';

const { Pool } = pg;

export class PostgresDatabase implements Database {
  private readonly pool: pg.Pool;

  constructor(config: Pick<AppConfig, 'DATABASE_URL' | 'DATABASE_SSL'>) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 15,
      idleTimeoutMillis: 30_000,
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
