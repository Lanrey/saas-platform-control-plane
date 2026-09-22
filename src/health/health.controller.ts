import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import { Pool } from 'pg';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { DATABASE_POOL } from '../database/database.module';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  /**
   * Liveness probe — is the process alive?
   * Returns 200 if the application is running (no dependency checks).
   * Kubernetes uses this to decide whether to restart a pod.
   */
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness check',
    description: 'Returns 200 if the application process is alive. No dependency checks.',
  })
  @ApiResponse({ status: 200, description: 'Application is alive' })
  liveness(): HealthCheckResult {
    return {
      status: 'ok',
      info: {
        application: { status: 'up' },
      },
      error: {},
      details: {
        application: { status: 'up' },
      },
    };
  }

  /**
   * Readiness probe — is the application ready to serve traffic?
   * Checks database connectivity. Returns 503 if any dependency is down.
   * Kubernetes uses this to decide whether to route traffic to a pod.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness check',
    description: 'Checks all dependencies (database, etc.). Returns 503 if any are unavailable.',
  })
  @ApiResponse({ status: 200, description: 'All dependencies healthy' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are down' })
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => {
        try {
          const client = await this.pool.connect();
          await client.query('SELECT 1');
          client.release();
          return { database: { status: 'up' } };
        } catch (err) {
          return {
            database: {
              status: 'down',
              message: (err as Error).message,
            },
          };
        }
      },
    ]);
  }
}
