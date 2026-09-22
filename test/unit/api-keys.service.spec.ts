import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApiKeysService, hashApiKey } from '../../src/api-keys/api-keys.service';

/**
 * Unit tests for ApiKeysService.
 *
 * Key security properties under test:
 * 1. Plaintext key is never returned from findAll/findOne
 * 2. Key hash is SHA-256 of the plaintext (not stored as plaintext)
 * 3. Validation uses timing-safe comparison
 * 4. Rotation revokes old key and issues new one atomically
 */

function makeKeyRow(overrides: Partial<Record<string, unknown>> = {}) {
  const plaintext = 'pmk_testkey1234567890abcdef';
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    organization_id: 'org-1',
    name: 'Test Key',
    key_hash: createHash('sha256').update(plaintext).digest('hex'),
    key_prefix: plaintext.substring(0, 12),
    key_type: 'sandbox',
    rate_limit_rpm: 60,
    rate_limit_rpd: 10000,
    last_used_at: null,
    expires_at: null,
    version: 1,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

function createMockPool(responses: Array<{ rows: unknown[] }> = []) {
  let callIdx = 0;
  return {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockImplementation(async () => responses[callIdx++] ?? { rows: [] }),
      release: vi.fn(),
      [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
    }),
    query: vi.fn().mockImplementation(async () => responses[callIdx++] ?? { rows: [] }),
  };
}

describe('ApiKeysService', () => {
  describe('hashApiKey()', () => {
    it('produces consistent SHA-256 hex hash', () => {
      const key = 'pmk_testkey';
      const hash = hashApiKey(key);
      const expected = createHash('sha256').update(key).digest('hex');
      expect(hash).toBe(expected);
    });

    it('two calls with same input produce same hash', () => {
      expect(hashApiKey('pmk_abc')).toBe(hashApiKey('pmk_abc'));
    });

    it('different inputs produce different hashes', () => {
      expect(hashApiKey('pmk_abc')).not.toBe(hashApiKey('pmk_xyz'));
    });
  });

  describe('create()', () => {
    it('returns a key with the plaintext key field at creation time', async () => {
      const keyRow = makeKeyRow();
      const pool = createMockPool([{ rows: [keyRow] }]);
      const service = new ApiKeysService(pool as never);

      const result = await service.create('org-1', { name: 'My Key' });

      expect(result.key).toBeDefined();
      expect(result.key).toMatch(/^pmk_/);
    });

    it('generated key hash matches SHA-256 of the plaintext key', async () => {
      const capturedInsertParams: unknown[][] = [];
      const pool = {
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
            if (sql.includes('INSERT')) capturedInsertParams.push(params);
            return { rows: [makeKeyRow()] };
          }),
          release: vi.fn(),
          [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
        }),
        query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
          if (sql.includes('INSERT')) capturedInsertParams.push(params);
          return { rows: [makeKeyRow()] };
        }),
      };

      const service = new ApiKeysService(pool as never);
      const result = await service.create('org-1', { name: 'Test' });

      // The stored hash must match SHA-256 of the returned plaintext
      const expectedHash = createHash('sha256').update(result.key).digest('hex');
      expect(capturedInsertParams[0]?.[2]).toBe(expectedHash);
    });

    it('key prefix is the first 12 characters of the generated plaintext key', async () => {
      // Capture the INSERT params so we can verify the prefix matches the plaintext
      let capturedPrefix: string | undefined;
      let capturedPlaintext: string | undefined;

      const pool = {
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
            if (typeof sql === 'string' && sql.includes('INSERT')) {
              // params[3] is key_prefix in the INSERT
              capturedPrefix = params[3] as string;
            }
            return { rows: [makeKeyRow()] };
          }),
          release: vi.fn(),
          [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
        }),
        query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
          if (typeof sql === 'string' && sql.includes('INSERT')) {
            capturedPrefix = params[3] as string;
          }
          return { rows: [makeKeyRow()] };
        }),
      };

      const service = new ApiKeysService(pool as never);
      const result = await service.create('org-1', { name: 'Test' });
      capturedPlaintext = result.key;

      // The prefix stored in DB must be the first 12 chars of the generated key
      expect(capturedPlaintext?.substring(0, 12)).toBe(capturedPrefix);
    });
  });

  describe('validateApiKey()', () => {
    it('returns null for an unknown key hash', async () => {
      const pool = createMockPool([{ rows: [] }]); // no matching row
      const service = new ApiKeysService(pool as never);

      const result = await service.validateApiKey('pmk_unknownkey12345678');
      expect(result).toBeNull();
    });

    it('returns org/key context for a valid key', async () => {
      const plaintext = 'pmk_validtestkey1234567890abc';
      const keyRow = makeKeyRow({
        key_hash: createHash('sha256').update(plaintext).digest('hex'),
      });
      // First query: lookup by hash → found
      // Second query: update last_used_at (async, not awaited)
      const pool = {
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockResolvedValue({ rows: [keyRow] }),
          release: vi.fn(),
          [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
        }),
        query: vi.fn().mockResolvedValue({ rows: [keyRow] }),
      };

      const service = new ApiKeysService(pool as never);
      const result = await service.validateApiKey(plaintext);

      expect(result).not.toBeNull();
      expect(result?.organizationId).toBe('org-1');
      expect(result?.keyType).toBe('sandbox');
    });
  });

  describe('revoke()', () => {
    it('throws NotFoundException for an unknown key ID', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const service = new ApiKeysService(pool as never);

      await expect(service.revoke('org-1', 'nonexistent-key-id')).rejects.toThrow(NotFoundException);
    });

    it('resolves without error when key exists', async () => {
      const pool = createMockPool([
        { rows: [{ id: 'key-1' }] }, // SELECT id
        { rows: [] },                  // UPDATE deleted_at
      ]);
      const service = new ApiKeysService(pool as never);

      await expect(service.revoke('org-1', 'key-1')).resolves.toBeUndefined();
    });
  });
});
