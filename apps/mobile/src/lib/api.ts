import type { ApiResponse } from '@ximo/shared';
import { supabase } from './supabase';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  if (init.idempotencyKey) headers.set('idempotency-key', init.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await response.json()) as ApiResponse<T>;
  if (!body.success) {
    throw new ApiError(body.error.message, body.error.code, response.status, body.error.details);
  }
  return body.data;
}
