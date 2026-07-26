import type { QueryResult, QueryResultRow } from 'pg';

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  transaction<T>(work: (transaction: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
