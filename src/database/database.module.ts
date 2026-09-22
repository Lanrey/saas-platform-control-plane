import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { DatabaseConfig } from '../config/database.config';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

/**
 * Database module — provides the pg connection pool as an injectable token.
 *
 * Marked @Global() so all feature modules can inject DATABASE_POOL without
 * importing DatabaseModule explicitly.
 *
 * Design decisions:
 * - pg Pool over ORM: direct SQL gives full control over query plans, avoids
 *   the N+1 pitfalls of lazy-loading ORMs, and makes migration SQL the
 *   unambiguous schema source of truth.
 * - Pool size: min=2 keeps warm connections during idle periods; max=20 prevents
 *   connection exhaustion on a typical PostgreSQL server (default max 100).
 * - statement_timeout prevents unbounded query time; idle_in_transaction prevents
 *   long-running transactions holding locks.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const db = config.get<DatabaseConfig>('database')!;
        return new Pool({
          host: db.host,
          port: db.port,
          database: db.name,
          user: db.user,
          password: db.password,
          min: db.poolMin,
          max: db.poolMax,
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
          statement_timeout: db.statementTimeout,
          idle_in_transaction_session_timeout:
            db.idleInTransactionSessionTimeout,
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 30000,
        });
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
