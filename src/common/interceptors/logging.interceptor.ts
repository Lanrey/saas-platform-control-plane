import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Request correlation + timing interceptor.
 *
 * Assigns a unique X-Request-ID to every request (if not already present from
 * the client) and logs method, path, status, and duration on completion.
 *
 * The request ID is threaded through response headers and the structured log
 * fields so that distributed traces can be correlated across services.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    // Assign or propagate request ID
    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? randomUUID();
    request.headers['x-request-id'] = requestId;
    void reply.header('X-Request-ID', requestId);

    const start = Date.now();
    const { method, url } = request;

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - start;
          const status = reply.statusCode;
          this.logger.log(
            {
              method,
              url,
              status,
              durationMs,
              requestId,
            },
            `${method} ${url} ${status} +${durationMs}ms`,
          );
        },
        error: (err: unknown) => {
          const durationMs = Date.now() - start;
          this.logger.error(
            {
              method,
              url,
              error: (err as Error).message,
              durationMs,
              requestId,
            },
            `${method} ${url} ERROR +${durationMs}ms`,
          );
        },
      }),
    );
  }
}
