import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProjectsModule } from './projects/projects.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { OAuthModule } from './oauth/oauth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    // Config — must come first so other modules can inject ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      envFilePath: ['.env.local', '.env'],
      expandVariables: true,
    }),

    // Structured JSON logging via pino
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        // Redact sensitive fields from logs
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'req.body.password',
            'req.body.clientSecret',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        customLogLevel: (_req, res) => {
          if (res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        serializers: {
          req: (req: { method: unknown; url: unknown; headers: { 'x-request-id': unknown } }) => ({
            method: req.method,
            url: req.url,
            requestId: req.headers['x-request-id'],
          }),
        },
      },
    }),

    // Feature modules
    DatabaseModule,
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    ApiKeysModule,
    OAuthModule,
    MetricsModule,
    TerminusModule,
  ],
  controllers: [HealthController, MetricsController],
})
export class AppModule {}
