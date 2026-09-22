import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a controller or route handler as public (no authentication required).
 *
 * @example
 * ```ts
 * @Public()
 * @Get('/health')
 * health() { ... }
 * ```
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
