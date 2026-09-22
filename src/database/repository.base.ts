import { Pool, PoolClient } from 'pg';
import { InternalServerErrorException, HttpException, Logger } from '@nestjs/common';

/**
 * Base repository with transaction helper using the `using` keyword (TS 5.2).
 *
 * The `using` keyword (Explicit Resource Management TC39 proposal, TS 5.2)
 * ensures PoolClient is always released back to the pool — even if an exception
 * is thrown mid-transaction. Without `using`, a missed `client.release()` in an
 * error path silently leaks the connection, eventually exhausting the pool.
 *
 * `[Symbol.asyncDispose]()` is called automatically when the `using` block exits.
 */
export class ReleasableClient {
  constructor(public readonly client: PoolClient) {}

  async [Symbol.asyncDispose](): Promise<void> {
    this.client.release();
  }
}

export abstract class BaseRepository {
  protected readonly logger: Logger;

  constructor(
    protected readonly pool: Pool,
    loggerContext: string,
  ) {
    this.logger = new Logger(loggerContext);
  }

  /**
   * Execute a function within a database transaction.
   * Commits on success, rolls back on any error.
   *
   * Uses TS 5.2 `using` / `Symbol.asyncDispose` for guaranteed client release.
   *
   * @example
   * ```ts
   * const result = await this.withTransaction(async (client) => {
   *   await client.query('INSERT INTO ...', [...]);
   *   await client.query('UPDATE ...', [...]);
   *   return result;
   * });
   * ```
   */
  protected async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    await using releasable = new ReleasableClient(await this.pool.connect());
    const { client } = releasable;

    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      // Re-throw NestJS HttpExceptions (ConflictException, NotFoundException, etc.)
      // without wrapping them — they carry the correct HTTP status and message.
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        { error: (error as Error).message },
        'Transaction rolled back',
      );
      throw new InternalServerErrorException({
        message: 'A database error occurred. Please try again.',
        code: 'DATABASE_ERROR',
      });
    }
  }

  /**
   * Execute a read-only query — no transaction overhead.
   * Uses `using` to ensure connection is returned to pool.
   */
  protected async query<T extends object>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    await using releasable = new ReleasableClient(await this.pool.connect());
    const result = await releasable.client.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Execute a read-only query expecting exactly one row.
   * Returns null if not found.
   */
  protected async queryOne<T extends object>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
}
