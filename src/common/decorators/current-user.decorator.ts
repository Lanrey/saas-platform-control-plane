import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export interface JwtUser {
  sub: string;          // user ID
  email: string;
  organizationIds: string[];
  iat: number;
  exp: number;
}

/**
 * Parameter decorator to extract the authenticated user from the JWT payload.
 *
 * @example
 * ```ts
 * @Get('/me')
 * getMe(@CurrentUser() user: JwtUser) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext): JwtUser | JwtUser[keyof JwtUser] => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user?: JwtUser }>();
    const user = request.user;
    if (!user) {
      throw new Error('CurrentUser decorator used without JWT authentication guard');
    }
    return data ? user[data] : user;
  },
);
