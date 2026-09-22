import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
} from '../../src/common/pagination/pagination.dto';
import { createPaginatedResponse } from '../../src/common/pagination/paginated-response';

describe('Cursor-based pagination', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('roundtrips a cursor payload', () => {
      const payload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2024-01-15T12:00:00.000Z',
      };

      const encoded = encodeCursor(payload);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(payload);
    });

    it('produces a URL-safe base64url string (no +, /, = characters)', () => {
      const payload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2024-03-20T18:30:00.000Z',
      };

      const encoded = encodeCursor(payload);

      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('returns null for a malformed cursor', () => {
      expect(decodeCursor('not-valid-base64!!!!')).toBeNull();
    });

    it('returns null for a cursor with missing fields', () => {
      const partial = Buffer.from(JSON.stringify({ id: 'abc' })).toString('base64url');
      expect(decodeCursor(partial)).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(decodeCursor('')).toBeNull();
    });
  });

  describe('createPaginatedResponse()', () => {
    it('returns hasMore=false when there are no more items', () => {
      const result = createPaginatedResponse(['a', 'b', 'c'], 3, null);

      expect(result.meta.hasMore).toBe(false);
      expect(result.meta.nextCursor).toBeNull();
      expect(result.meta.total).toBe(3);
    });

    it('returns hasMore=true and a cursor when nextCursor is provided', () => {
      const cursor = encodeCursor({ id: 'xyz', createdAt: '2024-01-01T00:00:00.000Z' });
      const result = createPaginatedResponse(['a', 'b'], 100, cursor);

      expect(result.meta.hasMore).toBe(true);
      expect(result.meta.nextCursor).toBe(cursor);
      expect(result.meta.total).toBe(100);
    });

    it('data array is passed through unchanged', () => {
      const items = [{ id: '1' }, { id: '2' }];
      const result = createPaginatedResponse(items, 2, null);

      expect(result.data).toStrictEqual(items);
    });
  });
});
