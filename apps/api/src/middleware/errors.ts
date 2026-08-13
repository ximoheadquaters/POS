import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: 'The requested API route does not exist' },
  });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const requestId = response.locals.requestId as string | undefined;
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const field = firstIssue?.path?.filter((part) => typeof part === 'string' || typeof part === 'number').join('.') || undefined;
    const firstMessage = firstIssue?.message?.trim();
    response.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message:
          firstMessage && firstMessage !== 'Invalid input'
            ? field
              ? `${field}: ${firstMessage}`
              : firstMessage
            : 'Request validation failed',
        details: error.flatten(),
        requestId,
      },
    });
    return;
  }
  if (error instanceof AppError) {
    response.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message, details: error.details, requestId },
    });
    return;
  }
  const pgError = error as {
    code?: string;
    constraint?: string;
    table?: string;
    message?: string;
  };
  const pgCode = pgError.code;
  if (
    pgCode === '53300' ||
    (pgCode === 'XX000' && /max clients reached|EMAXCONNSESSION/i.test(pgError.message ?? ''))
  ) {
    response.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_BUSY',
        message: 'Reports are temporarily busy. Please try again in a few seconds.',
        requestId,
      },
    });
    return;
  }
  if (pgCode === '23505') {
    const duplicate =
      pgError.constraint === 'product_barcodes_organization_id_barcode_key'
        ? {
            code: 'DUPLICATE_BARCODE',
            message: 'This barcode is already assigned to another product',
          }
        : pgError.constraint === 'products_organization_id_sku_key'
          ? { code: 'DUPLICATE_SKU', message: 'This SKU is already assigned to another product' }
          : { code: 'CONFLICT', message: 'A record with this value already exists' };
    response.status(409).json({
      success: false,
      error: { ...duplicate, requestId },
    });
    return;
  }
  if (pgCode === '42P01') {
    response.status(503).json({
      success: false,
      error: {
        code: 'SCHEMA_MISSING',
        message: 'Required database tables are missing. Apply pending migrations and try again.',
        requestId,
      },
    });
    return;
  }
  if (pgCode === '23503') {
    response.status(400).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_VIOLATION',
        message: 'One of the selected products is invalid or no longer available.',
        requestId,
      },
    });
    return;
  }
  console.error('[INTERNAL_ERROR]', error);
  response.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
  });
};
