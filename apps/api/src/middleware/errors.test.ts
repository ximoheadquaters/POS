import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './errors.js';

function appThatThrows(error: Error & { code?: string }) {
  const app = express();
  app.get('/failure', (_request, _response, next) => next(error));
  app.use(errorHandler);
  return app;
}

describe('API error handler', () => {
  it('returns a recoverable response when the PostgreSQL connection limit is reached', async () => {
    const error = Object.assign(
      new Error('(EMAXCONNSESSION) max clients reached in session mode'),
      { code: 'XX000' },
    );

    const response = await request(appThatThrows(error)).get('/failure').expect(503);

    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'DATABASE_BUSY',
        message: 'Reports are temporarily busy. Please try again in a few seconds.',
      },
    });
  });

  it('handles PostgreSQL too-many-connections errors reported with code 53300', async () => {
    const error = Object.assign(new Error('too many connections'), { code: '53300' });

    const response = await request(appThatThrows(error)).get('/failure').expect(503);

    expect(response.body.error.code).toBe('DATABASE_BUSY');
  });
});
