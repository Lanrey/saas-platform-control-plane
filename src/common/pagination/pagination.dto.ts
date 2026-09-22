import { z } from 'zod';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cursor-based pagination query parameters.
 *
 * Design decision: cursor pagination over offset pagination.
 *
 * Offset pagination (OFFSET N LIMIT M) degrades at scale:
 * - PostgreSQL must scan and discard N rows on each page
 * - Results shift when rows are inserted/deleted mid-pagination (ghost rows,
 *   duplicate rows across pages)
 * - N=100_000 with M=20 is effectively a full table scan per page request
 *
 * Cursor pagination uses a stable, opaque pointer (typically the last row's
 * `id` or composite key, encoded as base64). Each query is:
 *   WHERE id > $cursor ORDER BY id LIMIT $limit
 * This runs in O(1) regardless of page position, uses the primary key index,
 * and produces consistent results even under concurrent mutations.
 */
export const paginationSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum number of items to return (1–100)'),
  cursor: z
    .string()
    .optional()
    .describe(
      'Opaque pagination cursor from meta.nextCursor of the previous page',
    ),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

/** Cursor encoding: base64(JSON.stringify({ id, createdAt })) */
export interface CursorPayload {
  id: string;
  createdAt: string;
}

/**
 * Encode a cursor payload into an opaque, URL-safe string.
 * Using base64url (not standard base64) so the cursor is safe in query strings
 * without further percent-encoding.
 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString('base64url');
}

/**
 * Decode an opaque cursor back to its payload.
 * Returns null if the cursor is malformed — callers treat null as "start from
 * the beginning" (equivalent to no cursor being supplied).
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'createdAt' in parsed &&
      typeof (parsed as Record<string, unknown>).id === 'string' &&
      typeof (parsed as Record<string, unknown>).createdAt === 'string'
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** OpenAPI-annotated DTO wrapper for Swagger docs */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum number of items to return',
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor from the previous page meta.nextCursor',
    example: 'eyJpZCI6IjAxSFhZLi4uIiwiY3JlYXRlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMFoifQ',
  })
  cursor?: string;
}
