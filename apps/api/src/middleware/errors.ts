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
    response.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
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
  const pgError = error as { code?: string; constraint?: string };
  const pgCode = pgError.code;
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
  console.error('[INTERNAL_ERROR]', error);
  response.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
  });
};
