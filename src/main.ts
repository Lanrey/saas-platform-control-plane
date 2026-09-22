import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

/**
 * Bootstrap the NestJS application with Fastify adapter.
 *
 * Key decisions:
 * - Fastify over Express: ~2x throughput, native schema validation, better
 *   TypeScript ergonomics and hooks model
 * - Graceful shutdown: SIGTERM + SIGINT handlers drain in-flight requests
 *   before closing the DB pool — critical for zero-downtime deploys in k8s
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // pino-http handles logging instead
      trustProxy: true, // required for X-Forwarded-For behind load balancers
    }),
    {
      bufferLogs: true,
    },
  );

  // Use pino logger (structured JSON logging)
  app.useLogger(app.get(Logger));

  // Global prefix for all routes
  app.setGlobalPrefix('v1');

  // Global exception filter — RFC 9457 Problem Details format
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global response transformation + logging interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // CORS
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: corsOrigins,
    credentials: process.env.CORS_CREDENTIALS === 'true',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Request-ID',
      'Accept',
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-API-Deprecated',
      'Sunset',
      'Link',
    ],
  });

  // OpenAPI / Swagger
  const openApiConfig = new DocumentBuilder()
    .setTitle('Platform Management API')
    .setDescription(
      `Multi-tenant control plane for managing organizations, projects, API keys, and OAuth applications.

## Authentication

Two authentication methods are supported:

### Bearer JWT
Issue a JWT from \`POST /v1/auth/token\` and pass it as \`Authorization: Bearer <token>\`.

### API Key
Create an API key from \`POST /v1/organizations/{orgId}/api-keys\` and pass it as \`X-API-Key: <key>\`.

## Rate Limiting

All API keys are subject to per-minute (RPM) and per-day (RPD) rate limits.
Exceeded limits return \`429 Too Many Requests\` with \`Retry-After\` and \`X-RateLimit-*\` headers.

## Pagination

List endpoints use **cursor-based pagination** for scale-safe enumeration:
\`\`\`
GET /v1/organizations?limit=20&cursor=<opaque-cursor>
\`\`\`
Response includes \`meta.nextCursor\` for the next page (null on last page).

## Error Format

All errors follow [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457):
\`\`\`json
{
  "type": "https://platform-api.example.com/errors/not-found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "Organization with id '123' was not found",
  "instance": "/v1/organizations/123",
  "traceId": "01HXZ..."
}
\`\`\`
`,
    )
    .setVersion('1.0.0')
    .setContact(
      'Platform Team',
      'https://platform-api.example.com',
      'api@example.com',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token (RS256)',
      },
      'JWT',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key (pmk_... prefix)',
      },
      'ApiKey',
    )
    .addServer('http://localhost:3000', 'Local development')
    .addServer('https://api.platform.example.com', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`Platform Management API running on port ${port}`, 'Bootstrap');
  logger.log(`OpenAPI docs available at http://localhost:${port}/docs`, 'Bootstrap');

  // Graceful shutdown — critical for zero-downtime deploys
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, starting graceful shutdown...`, 'Bootstrap');
    // Close server (stop accepting new requests)
    await app.close();
    logger.log('Application shut down gracefully', 'Bootstrap');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
