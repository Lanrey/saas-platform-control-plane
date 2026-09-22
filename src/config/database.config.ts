import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const databaseConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.coerce.number().int().default(5432),
  name: z.string().default('platform_mgmt'),
  user: z.string().default('postgres'),
  password: z.string().default('postgres'),
  poolMin: z.coerce.number().int().default(2),
  poolMax: z.coerce.number().int().default(20),
  ssl: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),
  statementTimeout: z.coerce.number().int().default(30000),
  idleInTransactionSessionTimeout: z.coerce.number().int().default(60000),
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  const raw = {
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    name: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    poolMin: process.env.DATABASE_POOL_MIN,
    poolMax: process.env.DATABASE_POOL_MAX,
    ssl: process.env.DATABASE_SSL,
    statementTimeout: process.env.DATABASE_STATEMENT_TIMEOUT,
    idleInTransactionSessionTimeout:
      process.env.DATABASE_IDLE_IN_TRANSACTION_SESSION_TIMEOUT,
  };

  const parsed = databaseConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Database configuration validation failed:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }

  return parsed.data satisfies DatabaseConfig;
});
