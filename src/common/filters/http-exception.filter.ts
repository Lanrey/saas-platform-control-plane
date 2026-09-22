import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';

/**
 * Error codes enum — all error types the API can return.
 * Typed as a const enum for zero-runtime-cost string literals.
 */
export const enum ErrorCode {
  // 400
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_CURSOR = 'INVALID_CURSOR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  // 401
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  // 403
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_SCOPE = 'INSUFFICIENT_SCOPE',
  // 404
  NOT_FOUND = 'NOT_FOUND',
  // 409
  CONFLICT = 'CONFLICT',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  // 422
  UNPROCESSABLE = 'UNPROCESSABLE',
  // 429
  RATE_LIMITED = 'RATE_LIMITED',
  // 500
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/**
 * RFC 9457 Problem Details format.
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */
export interface ProblemDetails {
  /** URI reference that identifies the problem type */
  type: string;
  /** Short, human-readable summary */
  title: string;
  /** HTTP status code */
  status: number;
  /** Human-readable explanation specific to this occurrence */
  detail: string;
  /** URI reference to the specific resource with the problem */
  instance: string;
  /** Correlation ID for tracing */
  traceId: string;
  /** Application-specific error code */
  code?: string;
  /** Field-level validation errors (only on 422/400) */
  errors?: FieldError[];
}

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

const BASE_URL = 'https://platform-api.example.com/errors';

const STATUS_TO_TYPE: Record<number, string> = {
  400: `${BASE_URL}/bad-request`,
  401: `${BASE_URL}/unauthorized`,
  403: `${BASE_URL}/forbidden`,
  404: `${BASE_URL}/not-found`,
  409: `${BASE_URL}/conflict`,
  422: `${BASE_URL}/unprocessable-entity`,
  429: `${BASE_URL}/too-many-requests`,
  500: `${BASE_URL}/internal-server-error`,
};

const STATUS_TO_TITLE: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/**
 * Global exception filter that transforms all exceptions into RFC 9457
 * Problem Details responses.
 *
 * Key behaviors:
 * - Stack traces are NEVER included in responses (only logged server-side)
 * - 5xx errors get a generic message to avoid leaking internals
 * - Validation errors (from ZodValidationPipe) include structured field errors
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const traceId =
      (request.headers['x-request-id'] as string | undefined) ?? randomUUID();
    const instance = request.url;
    const isProduction = process.env.NODE_ENV === 'production';

    let status: number;
    let detail: string;
    let code: string | undefined;
    let errors: FieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        detail = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        detail = typeof resp['message'] === 'string' ? resp['message'] : exception.message;
        code = typeof resp['code'] === 'string' ? resp['code'] : undefined;
        if (Array.isArray(resp['errors'])) {
          errors = resp['errors'] as FieldError[];
        }
        // NestJS default validation errors come as string[]
        if (
          Array.isArray(resp['message']) &&
          (resp['message'] as unknown[]).every((m) => typeof m === 'string')
        ) {
          errors = (resp['message'] as string[]).map((m) => ({
            field: 'unknown',
            message: m,
          }));
          detail = 'Request validation failed';
        }
      } else {
        detail = exception.message;
      }
    } else {
      // Unhandled error — don't leak internals
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      const err = exception as Error;
      this.logger.error(
        {
          error: err.message,
          stack: err.stack,
          traceId,
          path: instance,
        },
        'Unhandled exception',
      );
      detail = isProduction
        ? 'An unexpected error occurred. Please try again later.'
        : (err.message ?? 'Internal server error');
    }

    const problem: ProblemDetails = {
      type: STATUS_TO_TYPE[status] ?? `${BASE_URL}/error`,
      title: STATUS_TO_TITLE[status] ?? 'Error',
      status,
      detail,
      instance,
      traceId,
      ...(code ? { code } : {}),
      ...(errors?.length ? { errors } : {}),
    };

    void reply
      .status(status)
      .header('Content-Type', 'application/problem+json')
      .header('X-Request-ID', traceId)
      .send(problem);
  }
}
