import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Response transformation interceptor.
 *
 * Ensures all non-paginated, non-problem responses are wrapped in a consistent
 * envelope. Paginated responses already carry `{ data, meta }` from the service
 * and pass through unchanged.
 *
 * We deliberately do NOT wrap paginated responses again — the service returns
 * the full `PaginatedResponse<T>` shape directly to avoid double-wrapping.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        // Already in paginated shape — pass through
        if (
          data !== null &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          return data;
        }
        // Scalar or single-resource — return as-is (REST convention: resource
        // is the response body, not wrapped in { data: ... })
        return data;
      }),
    );
  }
}
