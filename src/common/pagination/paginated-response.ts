import { ApiProperty } from '@nestjs/swagger';

/**
 * Pagination metadata returned in all list responses.
 */
export class PaginationMeta {
  @ApiProperty({ description: 'Whether more items are available', example: true })
  hasMore!: boolean;

  @ApiProperty({
    description: 'Opaque cursor for the next page, null on the last page',
    nullable: true,
    example: 'eyJpZCI6IjAxSFhZLi4uIn0',
  })
  nextCursor!: string | null;

  @ApiProperty({
    description: 'Total count of items matching the query (approximate for large datasets)',
    example: 42,
  })
  total!: number;
}

/**
 * Generic paginated response wrapper.
 *
 * TypeScript 5.x — `const` type parameters (TS 5.0):
 * Without `const`, `createPaginatedResponse(['a', 'b'])` would infer T as
 * `string[]`, losing the literal tuple type. With `const`, the inferred type
 * preserves the literal structure — useful for typed route testing.
 */
export class PaginatedResponse<T> {
  @ApiProperty({ isArray: true })
  data!: T[];

  @ApiProperty({ type: () => PaginationMeta })
  meta!: PaginationMeta;
}

/**
 * Factory — creates a typed paginated response object.
 *
 * @example
 * ```ts
 * return createPaginatedResponse(items, total, nextCursor);
 * ```
 */
export function createPaginatedResponse<const T>(
  data: T[],
  total: number,
  nextCursor: string | null,
): PaginatedResponse<T> {
  return {
    data,
    meta: {
      hasMore: nextCursor !== null,
      nextCursor,
      total,
    },
  };
}

/**
 * Utility type for a function that returns a paginated response.
 * Uses `NoInfer<T>` (TS 5.4) to prevent the return type from being widened
 * based on the caller's context — the T must be explicitly provided.
 */
export type PaginatedFetcher<T> = (
  limit: number,
  cursor: string | undefined,
) => Promise<PaginatedResponse<NoInfer<T>>>;
