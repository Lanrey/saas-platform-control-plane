import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export interface ApiKeyContext {
  organizationId: string;
  apiKeyId: string;
  keyType: 'sandbox' | 'production';
}

/**
 * Parameter decorator to extract the resolved API key context from the request.
 * Set by ApiKeyGuard after successful validation.
 *
 * @example
 * ```ts
 * @Get('/projects')
 * listProjects(@ApiKeyCtx() ctx: ApiKeyContext) { ... }
 * ```
 */
export const ApiKeyCtx = createParamDecorator(
  (
    data: keyof ApiKeyContext | undefined,
    ctx: ExecutionContext,
  ): ApiKeyContext | ApiKeyContext[keyof ApiKeyContext] => {
    const request = ctx
      .switchToHttp()
      .getRequest<FastifyRequest & { apiKeyContext?: ApiKeyContext }>();

    const keyContext = request.apiKeyContext;
    if (!keyContext) {
      throw new Error('ApiKeyCtx decorator used without ApiKeyGuard');
    }

    return data ? keyContext[data] : keyContext;
  },
);
