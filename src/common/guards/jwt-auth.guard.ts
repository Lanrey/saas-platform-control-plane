import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JWT authentication guard.
 *
 * Extends the passport JWT guard to:
 * 1. Support `@Public()` decorator to opt routes out of auth
 * 2. Return structured 401 errors in RFC 9457 format
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | import('rxjs').Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser>(err: Error | null, user: TUser | false): TUser {
    if (err || !user) {
      throw (
        err ??
        new UnauthorizedException({
          message: 'Authentication required. Provide a valid Bearer token or API key.',
          code: 'UNAUTHORIZED',
        })
      );
    }
    return user;
  }
}
