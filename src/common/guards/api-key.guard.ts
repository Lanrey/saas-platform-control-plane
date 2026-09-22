import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * API Key authentication guard.
 *
 * Checks for an X-API-Key header and validates it against the database.
 * API keys are stored as SHA-256 hashes — we hash the incoming key and
 * compare against the stored hash (constant-time comparison to prevent
 * timing attacks is handled by the crypto module).
 *
 * On success, attaches the resolved OrganizationId and ApiKeyId to the
 * request so downstream handlers can scope queries appropriately.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & {
      apiKeyContext?: { organizationId: string; apiKeyId: string; keyType: string };
    }>();

    const rawApiKey = request.headers['x-api-key'];
    if (!rawApiKey || typeof rawApiKey !== 'string') {
      throw new UnauthorizedException({
        message: 'API key required. Provide a valid X-API-Key header.',
        code: 'UNAUTHORIZED',
      });
    }

    const keyContext = await this.apiKeysService.validateApiKey(rawApiKey);
    if (!keyContext) {
      throw new UnauthorizedException({
        message: 'Invalid or revoked API key.',
        code: 'INVALID_TOKEN',
      });
    }

    // Attach context to request for downstream handlers
    request.apiKeyContext = keyContext;
    return true;
  }
}
