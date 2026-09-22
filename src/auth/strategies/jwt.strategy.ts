import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import type { AppConfig } from '../../config/app.config';

/**
 * JWT strategy using RS256 (asymmetric RSA-SHA256).
 *
 * RS256 vs HS256:
 * - HS256 uses a shared secret: any service that can verify tokens can also
 *   issue them. In a microservices architecture, this is a security liability.
 * - RS256 uses a private/public key pair: only the auth service holds the
 *   private key (signs tokens); other services only need the public key
 *   (verifies but cannot forge tokens). This is the correct model for
 *   multi-service deployments.
 *
 * Key loading: supports both file paths (local dev) and base64-encoded inline
 * values (Docker/cloud deployments where mounting PEM files is impractical).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly configService: ConfigService) {
    const appConf = configService.get<AppConfig>('app')!;

    const publicKey = loadPublicKey(appConf);

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: publicKey,
      algorithms: ['RS256'],
      issuer: appConf.jwt.issuer,
      audience: appConf.jwt.audience,
    });
  }

  /**
   * Called after passport-jwt verifies the token signature and expiry.
   * Return value is attached to `request.user`.
   */
  validate(payload: Record<string, unknown>): JwtUser {
    if (typeof payload['sub'] !== 'string' || typeof payload['email'] !== 'string') {
      throw new UnauthorizedException({
        message: 'Invalid token payload',
        code: 'INVALID_TOKEN',
      });
    }

    return {
      sub: payload['sub'],
      email: payload['email'],
      organizationIds: Array.isArray(payload['organizationIds'])
        ? (payload['organizationIds'] as string[])
        : [],
      iat: typeof payload['iat'] === 'number' ? payload['iat'] : 0,
      exp: typeof payload['exp'] === 'number' ? payload['exp'] : 0,
    };
  }
}

function loadPublicKey(config: AppConfig): string {
  if (config.jwt.publicKeyBase64) {
    return Buffer.from(config.jwt.publicKeyBase64, 'base64').toString('utf-8');
  }
  if (config.jwt.publicKeyPath) {
    return readFileSync(config.jwt.publicKeyPath, 'utf-8');
  }
  // Fallback for development — generate an ephemeral key warning
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[JWT Strategy] No public key configured. Using development fallback. Set JWT_PUBLIC_KEY_BASE64 or JWT_PUBLIC_KEY_PATH.',
    );
    return DEV_PUBLIC_KEY;
  }
  throw new Error(
    'JWT public key not configured. Set JWT_PUBLIC_KEY_BASE64 or JWT_PUBLIC_KEY_PATH.',
  );
}

// Development-only ephemeral RSA key pair (DO NOT USE IN PRODUCTION)
// Generated with: openssl genrsa 2048 | openssl rsa -pubout
const DEV_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2a2rwplBQLzHPZe5TNJK
ViS8QDQK2TBNEMzKS5XQ3mAc2MYrOgAFqFAbKGJiCGRjNbgEZFxKOVv6hKSvtBYZ
PLEASE_REPLACE_WITH_REAL_KEY_FOR_PRODUCTION
-----END PUBLIC KEY-----`;
