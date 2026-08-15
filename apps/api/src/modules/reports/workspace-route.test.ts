import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../../database/types.js';
import { errorHandler } from '../../middleware/errors.js';
import { result, testUser } from '../../test/fakes.js';
import { reportsRouter } from './routes.js';

class ParameterCheckingDatabase implements Database {
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const parameterNumbers = [...text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    const requiredParameters = parameterNumbers.length > 0 ? Math.max(...parameterNumbers) : 0;
    if (requiredParameters !== values.length) {
      throw new Error(
        `Query parameter mismatch: supplied ${values.length}, query requires ${requiredParameters}`,
      );
    }
    return result([] as T[]);
  }

  async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    return work(this);
  }

  async close(): Promise<void> {}
}

describe('Reports workspace route', () => {
  it('keeps every workspace SQL statement aligned with its supplied scope parameters', async () => {
    const database = new ParameterCheckingDatabase();
    const authUser = testUser({
      role: 'owner',
      modules: ['dashboard', 'reports'],
      permissions: [
        'reports:read',
        'reports:view_all_branches',
        'reports:view_cost',
        'reports:view_profit',
      ],
    });
    const app = express();
    app.use((request_, _response, next) => {
      request_.authUser = authUser;
      next();
    });
    app.use('/reports', reportsRouter(database));
    app.use(errorHandler);

    const response = await request(app).get(
      `/reports/workspace?from=2026-07-15&to=2026-08-13&branchId=${authUser.branches[0]!.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
