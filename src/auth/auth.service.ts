import {
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createHash, randomBytes, timingSafeEqual, scrypt } from 'crypto';
import { promisify } from 'util';
import { DATABASE_POOL } from '../database/database.module';
import { BaseRepository } from '../database/repository.base';
import type { LoginDto, TokenResponse } from './dto/token.dto';
import type { AppConfig } from '../config/app.config';

const scryptAsync = promisify(scrypt);

/**
 * Authentication service — issues and validates JWT tokens.
 *
 * Password hashing uses scrypt (memory-hard) rather than bcrypt:
 * - scrypt is tunable along memory cost (N), CPU cost (r), and parallelism (p)
 * - Memory-hardness makes it resistant to GPU brute-force attacks
 * - Node.js has a built-in `crypto.scrypt` (no additional dependencies)
 *
 * Token model:
 * - Short-lived access token (15m by default) — RS256 JWT
 * - Longer-lived refresh token (7d) — opaque, stored hashed in the DB
 */
@Injectable()
export class AuthService extends BaseRepository {
  private readonly appConfig: AppConfig;

  constructor(
    @Inject(DATABASE_POOL) pool: Pool,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super(pool, AuthService.name);
    this.appConfig = this.configService.get<AppConfig>('app')!;
  }

  async login(dto: LoginDto): Promise<TokenResponse> {
    const user = await this.queryOne<{
      id: string;
      email: string;
      password_hash: string;
    }>(
      `SELECT id, email, password_hash FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [dto.email],
    );

    if (!user || !(await verifyPassword(dto.password, user.password_hash))) {
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        code: 'UNAUTHORIZED',
      });
    }

    return this.issueTokenPair(user.id, user.email);
  }

  async refreshTokens(rawRefreshToken: string): Promise<TokenResponse> {
    const tokenHash = hashToken(rawRefreshToken);

    const stored = await this.queryOne<{
      id: string;
      user_id: string;
      expires_at: Date;
    }>(
      `SELECT rt.id, rt.user_id, rt.expires_at
       FROM oauth_refresh_tokens rt
       WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL`,
      [tokenHash],
    );

    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException({
        message: 'Refresh token is invalid or expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    // Revoke the used refresh token (rotation — prevents reuse)
    await this.query(
      `UPDATE oauth_refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
      [stored.id],
    );

    const user = await this.queryOne<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [stored.user_id],
    );

    if (!user) {
      throw new UnauthorizedException({ message: 'User not found', code: 'UNAUTHORIZED' });
    }

    return this.issueTokenPair(user.id, user.email);
  }

  private async issueTokenPair(userId: string, email: string): Promise<TokenResponse> {
    const orgRows = await this.query<{ organization_id: string }>(
      `SELECT organization_id FROM organization_members WHERE user_id = $1`,
      [userId],
    );
    const organizationIds = orgRows.map((r) => r.organization_id);

    const expiresIn = parseDurationToSeconds(this.appConfig.jwt.expiresIn);

    const accessToken = await this.jwtService.signAsync(
      {
        sub: userId,
        email,
        organizationIds,
      },
      {
        expiresIn: this.appConfig.jwt.expiresIn,
        issuer: this.appConfig.jwt.issuer,
        audience: this.appConfig.jwt.audience,
      },
    );

    // Refresh token — opaque, stored as hash
    const rawRefreshToken = `rt_${randomBytes(48).toString('base64url')}`;
    const refreshHash = hashToken(rawRefreshToken);
    const refreshExpires = new Date(
      Date.now() + this.appConfig.oauth.refreshTokenTtlDays * 86400 * 1000,
    );

    // Store in oauth_access_tokens so we can revoke via the OAuth endpoints
    const atResult = await this.queryOne<{ id: string }>(
      `INSERT INTO oauth_access_tokens
         (token_hash, client_id, user_id, scopes, expires_at)
       VALUES ($1, 'internal', $2, '{}', $3)
       RETURNING id`,
      [
        hashToken(accessToken),
        userId,
        new Date(Date.now() + expiresIn * 1000),
      ],
    );

    await this.query(
      `INSERT INTO oauth_refresh_tokens
         (token_hash, access_token_id, client_id, user_id, expires_at)
       VALUES ($1, $2, 'internal', $3, $4)`,
      [refreshHash, atResult!.id, userId, refreshExpires],
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      tokenType: 'Bearer',
      expiresIn,
    };
  }
}

// -------- Helpers --------

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedKeyBuf = Buffer.from(hash, 'hex');
  if (derivedKey.length !== storedKeyBuf.length) return false;
  return timingSafeEqual(derivedKey, storedKeyBuf);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 900; // default 15 minutes
  const value = parseInt(match[1]!, 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 900;
  }
}
