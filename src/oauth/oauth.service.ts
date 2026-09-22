import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createHash, randomBytes } from 'crypto';
import { DATABASE_POOL } from '../database/database.module';
import { BaseRepository } from '../database/repository.base';
import {
  OAuthApplication,
  OAuthApplicationRow,
  mapOAuthAppRow,
} from './entities/oauth-app.entity';
import type { AppConfig } from '../config/app.config';

/**
 * OAuth 2.0 service implementing:
 * - Authorization Code flow (with PKCE support for public clients)
 * - Client Credentials flow (for server-to-server)
 * - Token introspection
 * - Token revocation
 *
 * RFC references:
 * - RFC 6749: The OAuth 2.0 Authorization Framework
 * - RFC 7636: PKCE for OAuth Public Clients
 * - RFC 7009: Token Revocation
 * - RFC 7662: Token Introspection
 */
@Injectable()
export class OAuthService extends BaseRepository {
  private readonly appConfig: AppConfig;

  constructor(
    @Inject(DATABASE_POOL) pool: Pool,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super(pool, OAuthService.name);
    this.appConfig = configService.get<AppConfig>('app')!;
  }

  // -------- Applications --------

  async registerApp(
    organizationId: string | null,
    dto: {
      name: string;
      description?: string;
      redirectUris: string[];
      scopes?: string[];
      isPublic?: boolean;
      logoUrl?: string;
      websiteUrl?: string;
    },
  ): Promise<OAuthApplication & { clientSecret?: string }> {
    const clientId = `app_${randomBytes(16).toString('base64url')}`;
    const rawSecret = `cs_${randomBytes(32).toString('base64url')}`;
    const secretHash = hashValue(rawSecret);

    const row = await this.queryOne<OAuthApplicationRow>(
      `INSERT INTO oauth_applications
         (organization_id, name, description, client_id, client_secret_hash,
          redirect_uris, scopes, is_public, logo_url, website_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        organizationId,
        dto.name,
        dto.description ?? null,
        clientId,
        secretHash,
        dto.redirectUris,
        dto.scopes ?? [],
        dto.isPublic ?? false,
        dto.logoUrl ?? null,
        dto.websiteUrl ?? null,
      ],
    );

    const app = mapOAuthAppRow(row!);

    // Return client secret only at registration time
    return { ...app, clientSecret: dto.isPublic ? undefined : rawSecret };
  }

  async listApps(organizationId: string): Promise<OAuthApplication[]> {
    const rows = await this.query<OAuthApplicationRow>(
      `SELECT * FROM oauth_applications
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [organizationId],
    );
    return rows.map(mapOAuthAppRow);
  }

  async getApp(appId: string): Promise<OAuthApplication> {
    const row = await this.queryOne<OAuthApplicationRow>(
      `SELECT * FROM oauth_applications WHERE id = $1 AND deleted_at IS NULL`,
      [appId],
    );
    if (!row) throw new NotFoundException({ message: `OAuth app '${appId}' not found`, code: 'NOT_FOUND' });
    return mapOAuthAppRow(row);
  }

  async updateApp(
    appId: string,
    dto: Partial<{
      name: string;
      description: string;
      redirectUris: string[];
      scopes: string[];
      logoUrl: string;
      websiteUrl: string;
    }>,
  ): Promise<OAuthApplication> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) { updates.push(`name = $${idx++}`); params.push(dto.name); }
    if (dto.description !== undefined) { updates.push(`description = $${idx++}`); params.push(dto.description); }
    if (dto.redirectUris !== undefined) { updates.push(`redirect_uris = $${idx++}`); params.push(dto.redirectUris); }
    if (dto.scopes !== undefined) { updates.push(`scopes = $${idx++}`); params.push(dto.scopes); }
    if (dto.logoUrl !== undefined) { updates.push(`logo_url = $${idx++}`); params.push(dto.logoUrl); }
    if (dto.websiteUrl !== undefined) { updates.push(`website_url = $${idx++}`); params.push(dto.websiteUrl); }

    if (updates.length === 0) return this.getApp(appId);

    updates.push('version = version + 1');
    params.push(appId);

    const row = await this.queryOne<OAuthApplicationRow>(
      `UPDATE oauth_applications SET ${updates.join(', ')}
       WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`,
      params,
    );
    if (!row) throw new NotFoundException({ message: `OAuth app not found`, code: 'NOT_FOUND' });
    return mapOAuthAppRow(row);
  }

  async deleteApp(appId: string): Promise<void> {
    await this.getApp(appId);
    await this.query(
      `UPDATE oauth_applications SET deleted_at = NOW() WHERE id = $1`,
      [appId],
    );
  }

  // -------- Authorization Code Flow --------

  /**
   * Validate an authorization request and create an authorization code.
   * Called after the user grants consent.
   */
  async createAuthorizationCode(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    userId: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256' | 'plain';
  }): Promise<string> {
    const app = await this.queryOne<OAuthApplicationRow>(
      `SELECT * FROM oauth_applications WHERE client_id = $1 AND deleted_at IS NULL`,
      [params.clientId],
    );

    if (!app) {
      throw new BadRequestException({ message: 'Invalid client_id', code: 'INVALID_REQUEST' });
    }

    if (!app.redirect_uris.includes(params.redirectUri)) {
      throw new BadRequestException({
        message: 'redirect_uri does not match registered URIs',
        code: 'INVALID_REQUEST',
      });
    }

    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.appConfig.oauth.authCodeTtlSeconds * 1000,
    );

    await this.query(
      `INSERT INTO oauth_authorization_codes
         (code, client_id, user_id, redirect_uri, scopes,
          code_challenge, code_challenge_method, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        code,
        params.clientId,
        params.userId,
        params.redirectUri,
        params.scopes,
        params.codeChallenge ?? null,
        params.codeChallengeMethod ?? null,
        expiresAt,
      ],
    );

    return code;
  }

  /**
   * Exchange an authorization code for tokens (RFC 6749 Section 4.1.3).
   */
  async exchangeAuthorizationCode(params: {
    code: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope: string }> {
    const codeRow = await this.queryOne<{
      id: string;
      client_id: string;
      user_id: string;
      redirect_uri: string;
      scopes: string[];
      code_challenge: string | null;
      code_challenge_method: string | null;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT * FROM oauth_authorization_codes
       WHERE code = $1 AND used_at IS NULL`,
      [params.code],
    );

    if (!codeRow || codeRow.expires_at < new Date()) {
      throw new BadRequestException({
        message: 'Authorization code is invalid or expired',
        code: 'INVALID_REQUEST',
      });
    }

    if (codeRow.client_id !== params.clientId) {
      throw new UnauthorizedException({ message: 'client_id mismatch', code: 'UNAUTHORIZED' });
    }

    if (codeRow.redirect_uri !== params.redirectUri) {
      throw new BadRequestException({ message: 'redirect_uri mismatch', code: 'INVALID_REQUEST' });
    }

    // PKCE verification
    if (codeRow.code_challenge) {
      if (!params.codeVerifier) {
        throw new BadRequestException({ message: 'code_verifier required', code: 'INVALID_REQUEST' });
      }
      const expected =
        codeRow.code_challenge_method === 'S256'
          ? createHash('sha256').update(params.codeVerifier).digest('base64url')
          : params.codeVerifier;
      if (expected !== codeRow.code_challenge) {
        throw new BadRequestException({ message: 'code_verifier is invalid', code: 'INVALID_REQUEST' });
      }
    }

    // Mark code as used (single-use enforcement)
    await this.query(
      `UPDATE oauth_authorization_codes SET used_at = NOW() WHERE id = $1`,
      [codeRow.id],
    );

    return this.issueTokenPair(
      codeRow.user_id,
      params.clientId,
      codeRow.scopes,
      null,
    );
  }

  /**
   * Client Credentials flow (RFC 6749 Section 4.4).
   * Used for server-to-server authentication without user context.
   */
  async clientCredentials(params: {
    clientId: string;
    clientSecret: string;
    scopes?: string[];
    organizationId?: string;
  }): Promise<{ accessToken: string; expiresIn: number; scope: string; tokenType: string }> {
    const app = await this.queryOne<OAuthApplicationRow>(
      `SELECT * FROM oauth_applications
       WHERE client_id = $1 AND deleted_at IS NULL AND is_public = false`,
      [params.clientId],
    );

    if (!app) {
      throw new UnauthorizedException({ message: 'Invalid client credentials', code: 'UNAUTHORIZED' });
    }

    const secretHash = hashValue(params.clientSecret);
    const storedHash = app.client_secret_hash;
    if (secretHash !== storedHash) {
      throw new UnauthorizedException({ message: 'Invalid client credentials', code: 'UNAUTHORIZED' });
    }

    const scopes = params.scopes ?? app.scopes;
    const expiresAt = new Date(
      Date.now() + this.appConfig.oauth.accessTokenTtlSeconds * 1000,
    );

    const accessToken = await this.jwtService.signAsync({
      sub: params.clientId,
      client_id: params.clientId,
      organization_id: params.organizationId ?? null,
      scope: scopes.join(' '),
      grant_type: 'client_credentials',
    }, { expiresIn: this.appConfig.oauth.accessTokenTtlSeconds });

    await this.query(
      `INSERT INTO oauth_access_tokens
         (token_hash, client_id, organization_id, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        hashValue(accessToken),
        params.clientId,
        params.organizationId ?? null,
        scopes,
        expiresAt,
      ],
    );

    return {
      accessToken,
      expiresIn: this.appConfig.oauth.accessTokenTtlSeconds,
      scope: scopes.join(' '),
      tokenType: 'Bearer',
    };
  }

  /**
   * Revoke a token (RFC 7009).
   */
  async revokeToken(token: string, _hint?: string): Promise<void> {
    const hash = hashValue(token);
    // Try access token first, then refresh token
    await this.query(
      `UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
      [hash],
    );
    await this.query(
      `UPDATE oauth_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
      [hash],
    );
  }

  private async issueTokenPair(
    userId: string,
    clientId: string,
    scopes: string[],
    organizationId: string | null,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope: string }> {
    const expiresIn = this.appConfig.oauth.accessTokenTtlSeconds;
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, client_id: clientId, scope: scopes.join(' ') },
      { expiresIn },
    );

    const rawRefresh = `rt_${randomBytes(48).toString('base64url')}`;
    const refreshExpires = new Date(
      Date.now() + this.appConfig.oauth.refreshTokenTtlDays * 86400 * 1000,
    );

    const atRow = await this.queryOne<{ id: string }>(
      `INSERT INTO oauth_access_tokens
         (token_hash, client_id, user_id, organization_id, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        hashValue(accessToken),
        clientId,
        userId,
        organizationId,
        scopes,
        new Date(Date.now() + expiresIn * 1000),
      ],
    );

    await this.query(
      `INSERT INTO oauth_refresh_tokens
         (token_hash, access_token_id, client_id, user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [hashValue(rawRefresh), atRow!.id, clientId, userId, refreshExpires],
    );

    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn,
      scope: scopes.join(' '),
    };
  }
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
