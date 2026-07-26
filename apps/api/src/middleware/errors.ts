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
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '23505') {
    response.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'A record with this value already exists', requestId },
    });
    return;
  }
  response.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
  });
};
