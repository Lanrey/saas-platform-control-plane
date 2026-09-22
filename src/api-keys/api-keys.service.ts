import {
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { Pool } from 'pg';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { DATABASE_POOL } from '../database/database.module';
import { BaseRepository } from '../database/repository.base';
import {
  ApiKey,
  ApiKeyWithSecret,
  ApiKeyRow,
  mapApiKeyRow,
} from './entities/api-key.entity';

const DEFAULT_PREFIX = 'pmk_';
const KEY_ENTROPY_BYTES = 32;

/**
 * API Keys service.
 *
 * Security model:
 * - Plaintext key is generated with 32 bytes of cryptographic randomness
 *   → base64url encoded → 43 characters of entropy
 * - SHA-256 hash stored in the database — plaintext NEVER persisted
 * - Key prefix (first 12 chars) stored for display purposes in the UI
 * - Timing-safe comparison used during validation to prevent timing attacks
 *
 * The key format: `pmk_{base64url(32 random bytes)}`
 * Example: `pmk_Zx9K2mN8vL4pQ7rT1wY5uA3cE6fJ0hB`
 */
@Injectable()
export class ApiKeysService extends BaseRepository {
  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    super(pool, ApiKeysService.name);
  }

  /**
   * Generate a new API key for an organization.
   * Returns the plaintext key ONCE — it cannot be retrieved again.
   */
  async create(
    organizationId: string,
    options: {
      name: string;
      keyType?: 'sandbox' | 'production';
      rateLimitRpm?: number;
      rateLimitRpd?: number;
      expiresAt?: Date;
    },
  ): Promise<ApiKeyWithSecret> {
    const { plaintext, hash, prefix } = generateApiKey();

    const row = await this.queryOne<ApiKeyRow>(
      `INSERT INTO api_keys
         (organization_id, name, key_hash, key_prefix, key_type,
          rate_limit_rpm, rate_limit_rpd, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        organizationId,
        options.name,
        hash,
        prefix,
        options.keyType ?? 'sandbox',
        options.rateLimitRpm ?? 60,
        options.rateLimitRpd ?? 10000,
        options.expiresAt ?? null,
      ],
    );

    return {
      ...mapApiKeyRow(row!),
      key: plaintext,
    };
  }

  async findAll(organizationId: string): Promise<ApiKey[]> {
    const rows = await this.query<ApiKeyRow>(
      `SELECT * FROM api_keys
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [organizationId],
    );
    return rows.map(mapApiKeyRow);
  }

  /**
   * Validate an incoming API key from the X-API-Key header.
   * Returns context if valid, null if invalid/revoked/expired.
   *
   * Timing-safe: we hash the incoming key first, then compare hashes
   * using `timingSafeEqual` to prevent timing-based oracle attacks.
   */
  async validateApiKey(
    rawKey: string,
  ): Promise<{ organizationId: string; apiKeyId: string; keyType: string } | null> {
    const incomingHash = hashApiKey(rawKey);

    const row = await this.queryOne<ApiKeyRow>(
      `SELECT * FROM api_keys
       WHERE key_hash = $1
         AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [incomingHash],
    );

    if (!row) return null;

    // Additional timing-safe comparison as defense-in-depth
    const storedHashBuf = Buffer.from(row.key_hash, 'hex');
    const incomingHashBuf = Buffer.from(incomingHash, 'hex');
    if (
      storedHashBuf.length !== incomingHashBuf.length ||
      !timingSafeEqual(storedHashBuf, incomingHashBuf)
    ) {
      return null;
    }

    // Update last_used_at asynchronously — don't block the request
    void this.query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
      [row.id],
    );

    return {
      organizationId: row.organization_id,
      apiKeyId: row.id,
      keyType: row.key_type,
    };
  }

  /**
   * Revoke (soft-delete) an API key.
   */
  async revoke(organizationId: string, keyId: string): Promise<void> {
    const row = await this.queryOne<{ id: string }>(
      `SELECT id FROM api_keys
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [keyId, organizationId],
    );

    if (!row) {
      throw new NotFoundException({
        message: `API key '${keyId}' not found`,
        code: 'NOT_FOUND',
      });
    }

    await this.query(
      `UPDATE api_keys SET deleted_at = NOW() WHERE id = $1`,
      [keyId],
    );
  }

  /**
   * Rotate an API key — revoke the old one and issue a new one.
   * Atomic: both operations happen in a single transaction.
   */
  async rotate(organizationId: string, keyId: string): Promise<ApiKeyWithSecret> {
    const current = await this.queryOne<ApiKeyRow>(
      `SELECT * FROM api_keys
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [keyId, organizationId],
    );

    if (!current) {
      throw new NotFoundException({
        message: `API key '${keyId}' not found`,
        code: 'NOT_FOUND',
      });
    }

    return this.withTransaction(async (client) => {
      // Revoke old key
      await client.query(
        `UPDATE api_keys SET deleted_at = NOW() WHERE id = $1`,
        [keyId],
      );

      // Create replacement
      const { plaintext, hash, prefix } = generateApiKey();
      const result = await client.query<ApiKeyRow>(
        `INSERT INTO api_keys
           (organization_id, name, key_hash, key_prefix, key_type,
            rate_limit_rpm, rate_limit_rpd)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          organizationId,
          current.name,
          hash,
          prefix,
          current.key_type,
          current.rate_limit_rpm,
          current.rate_limit_rpd,
        ],
      );

      return {
        ...mapApiKeyRow(result.rows[0]!),
        key: plaintext,
      };
    });
  }
}

// -------- Key generation helpers --------

/**
 * Generate a cryptographically random API key.
 * Returns plaintext, SHA-256 hex hash, and display prefix.
 */
function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const entropy = randomBytes(KEY_ENTROPY_BYTES);
  const encoded = entropy.toString('base64url');
  const plaintext = `${DEFAULT_PREFIX}${encoded}`;
  const hash = hashApiKey(plaintext);
  const prefix = plaintext.substring(0, 12);
  return { plaintext, hash, prefix };
}

/**
 * Hash an API key for storage using SHA-256.
 * Returns a hex-encoded string.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
