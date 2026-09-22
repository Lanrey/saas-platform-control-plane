import { registerAs } from '@nestjs/config';
import { z } from 'zod';

/**
 * Application configuration schema.
 *
 * The `satisfies` operator (TS 4.9+) is used here to get both type narrowing
 * AND type checking — without `satisfies`, widening to `Record<string, unknown>`
 * would lose the literal types we rely on for downstream inference.
 */

// Zod schema for runtime validation — guarantees the shape at startup,
// not just at compile time. Missing required env vars throw immediately.
const appConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().min(1024).max(65535).default(3000),
  apiVersion: z.string().default('v1'),

  jwt: z.object({
    privateKeyPath: z.string().optional(),
    publicKeyPath: z.string().optional(),
    privateKeyBase64: z.string().optional(),
    publicKeyBase64: z.string().optional(),
    expiresIn: z.string().default('15m'),
    refreshExpiresIn: z.string().default('7d'),
    issuer: z.string().default('platform-mgmt-api'),
    audience: z.string().default('platform-mgmt-clients'),
  }),

  oauth: z.object({
    authCodeTtlSeconds: z.coerce.number().default(600),
    accessTokenTtlSeconds: z.coerce.number().default(3600),
    refreshTokenTtlDays: z.coerce.number().default(30),
  }),

  apiKey: z.object({
    prefix: z.string().default('pmk_'),
    entropyBytes: z.coerce.number().default(32),
  }),

  rateLimit: z.object({
    defaultRpm: z.coerce.number().default(60),
    defaultRpd: z.coerce.number().default(10000),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
    db: z.coerce.number().default(0),
  }),

  cors: z.object({
    origins: z
      .string()
      .default('http://localhost:3000')
      .transform((s) => s.split(',').map((o) => o.trim())),
    credentials: z
      .string()
      .default('true')
      .transform((s) => s === 'true'),
  }),

  metrics: z.object({
    enabled: z
      .string()
      .default('true')
      .transform((s) => s === 'true'),
    path: z.string().default('/metrics'),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Factory function registered with NestJS ConfigModule.
 * Throws at startup if required env vars are missing — fail-fast is
 * far better than silent misconfiguration discovered in production.
 */
export const appConfig = registerAs('app', (): AppConfig => {
  const raw = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    apiVersion: process.env.API_VERSION,
    jwt: {
      privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH,
      publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH,
      privateKeyBase64: process.env.JWT_PRIVATE_KEY_BASE64,
      publicKeyBase64: process.env.JWT_PUBLIC_KEY_BASE64,
      expiresIn: process.env.JWT_EXPIRES_IN,
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    },
    oauth: {
      authCodeTtlSeconds: process.env.OAUTH_AUTH_CODE_TTL_SECONDS,
      accessTokenTtlSeconds: process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: process.env.OAUTH_REFRESH_TOKEN_TTL_DAYS,
    },
    apiKey: {
      prefix: process.env.API_KEY_PREFIX,
      entropyBytes: process.env.API_KEY_ENTROPY_BYTES,
    },
    rateLimit: {
      defaultRpm: process.env.RATE_LIMIT_DEFAULT_RPM,
      defaultRpd: process.env.RATE_LIMIT_DEFAULT_RPD,
    },
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB,
    },
    cors: {
      origins: process.env.CORS_ORIGINS,
      credentials: process.env.CORS_CREDENTIALS,
    },
    metrics: {
      enabled: process.env.METRICS_ENABLED,
      path: process.env.METRICS_PATH,
    },
  };

  const parsed = appConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `App configuration validation failed:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }

  // satisfies operator: checked against AppConfig without widening to `object`
  return parsed.data satisfies AppConfig;
});
