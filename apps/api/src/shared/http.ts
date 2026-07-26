import type { Response } from 'express';
import type { ApiSuccess } from '@ximo/shared';

export function sendData<T>(response: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { success: true, data };
  response.status(status).json(body);
}

export function sendPage<T>(
  response: Response,
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): void {
  response.json({
    success: true,
    data: items,
    meta: { page, pageSize, total, requestId: response.locals.requestId as string },
  });
}
