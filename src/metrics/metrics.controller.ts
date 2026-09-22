import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Prometheus metrics endpoint.
   * In production, protect this with HTTP Basic auth or network-level ACLs.
   */
  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({
    summary: 'Prometheus metrics',
    description:
      'Exposes application metrics in Prometheus text format. Scrape with a Prometheus instance.',
  })
  @ApiResponse({
    status: 200,
    description: 'Prometheus text format metrics',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  getMetrics(): string {
    return this.metricsService.toPrometheusFormat();
  }
}
