import { Injectable } from '@nestjs/common';

/**
 * In-memory Prometheus-format metrics service.
 *
 * A production system would use the `prom-client` library for proper
 * histogram bucketing and exposition. This implementation provides the
 * key metrics in correct Prometheus text format without adding a dependency.
 *
 * Metrics exposed:
 * - http_requests_total (counter, by method/route/status)
 * - http_request_duration_seconds (histogram, by method/route)
 * - active_connections (gauge)
 * - api_key_validations_total (counter, by result)
 */
@Injectable()
export class MetricsService {
  private requestCounts = new Map<string, number>();
  private requestDurations = new Map<string, number[]>();
  private apiKeyValidations = { valid: 0, invalid: 0 };
  private activeConnections = 0;
  private readonly startTime = Date.now();

  recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const labelKey = `${method}__${route}__${statusCode}`;
    this.requestCounts.set(labelKey, (this.requestCounts.get(labelKey) ?? 0) + 1);

    const durationKey = `${method}__${route}`;
    const durations = this.requestDurations.get(durationKey) ?? [];
    durations.push(durationMs / 1000); // convert to seconds
    // Keep last 1000 samples per route to bound memory
    if (durations.length > 1000) durations.shift();
    this.requestDurations.set(durationKey, durations);
  }

  recordApiKeyValidation(valid: boolean): void {
    if (valid) this.apiKeyValidations.valid++;
    else this.apiKeyValidations.invalid++;
  }

  incrementConnections(): void {
    this.activeConnections++;
  }

  decrementConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  /**
   * Render metrics in Prometheus text exposition format.
   * @see https://prometheus.io/docs/instrumenting/exposition_formats/
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;

    // process uptime
    lines.push('# HELP process_uptime_seconds Time the process has been running');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${uptimeSeconds.toFixed(3)}`);

    // memory
    const mem = process.memoryUsage();
    lines.push('# HELP process_heap_bytes Node.js heap usage');
    lines.push('# TYPE process_heap_bytes gauge');
    lines.push(`process_heap_used_bytes ${mem.heapUsed}`);
    lines.push(`process_heap_total_bytes ${mem.heapTotal}`);
    lines.push(`process_rss_bytes ${mem.rss}`);

    // active connections
    lines.push('# HELP active_connections Current active connections');
    lines.push('# TYPE active_connections gauge');
    lines.push(`active_connections ${this.activeConnections}`);

    // http request counts
    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, count] of this.requestCounts.entries()) {
      const [method, route, status] = key.split('__');
      lines.push(
        `http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`,
      );
    }

    // http request duration histogram (simplified — buckets + sum + count)
    lines.push('# HELP http_request_duration_seconds HTTP request duration');
    lines.push('# TYPE http_request_duration_seconds histogram');
    const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    for (const [key, samples] of this.requestDurations.entries()) {
      const [method, route] = key.split('__');
      const labels = `method="${method}",route="${route}"`;
      const sum = samples.reduce((a, b) => a + b, 0);
      const count = samples.length;
      for (const bucket of buckets) {
        const belowBucket = samples.filter((s) => s <= bucket).length;
        lines.push(`http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${belowBucket}`);
      }
      lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${count}`);
      lines.push(`http_request_duration_seconds_sum{${labels}} ${sum.toFixed(6)}`);
      lines.push(`http_request_duration_seconds_count{${labels}} ${count}`);
    }

    // API key validations
    lines.push('# HELP api_key_validations_total API key validation outcomes');
    lines.push('# TYPE api_key_validations_total counter');
    lines.push(`api_key_validations_total{result="valid"} ${this.apiKeyValidations.valid}`);
    lines.push(`api_key_validations_total{result="invalid"} ${this.apiKeyValidations.invalid}`);

    return lines.join('\n') + '\n';
  }
}
