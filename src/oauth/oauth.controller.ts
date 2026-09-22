import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { OAuthService } from './oauth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const registerAppSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  redirectUris: z.array(z.string().url()).min(1),
  scopes: z.array(z.string()).default([]),
  isPublic: z.boolean().default(false),
  logoUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
});

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    client_id: z.string().min(1),
    client_secret: z.string().optional(),
    redirect_uri: z.string().url(),
    code_verifier: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal('client_credentials'),
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    scope: z.string().optional(),
  }),
]);

@ApiTags('OAuth 2.0')
@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  // -------- Applications --------

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Post('applications')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register an OAuth application' })
  @ApiResponse({ status: 201, description: 'Application registered. Client secret returned once.' })
  registerApp(
    @Body(new ZodValidationPipe(registerAppSchema)) dto: z.infer<typeof registerAppSchema>,
    @CurrentUser() user: JwtUser,
  ) {
    // Use first org from token — real impl would take orgId as param
    const orgId = user.organizationIds[0] ?? null;
    return this.oauthService.registerApp(orgId, dto);
  }

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Get('applications')
  @ApiOperation({ summary: 'List OAuth applications' })
  listApps(@CurrentUser() user: JwtUser) {
    const orgId = user.organizationIds[0];
    if (!orgId) throw new BadRequestException({ message: 'No organization associated with this token', code: 'INVALID_REQUEST' });
    return this.oauthService.listApps(orgId);
  }

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Get('applications/:id')
  @ApiOperation({ summary: 'Get an OAuth application' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  getApp(@Param('id', ParseUUIDPipe) id: string) {
    return this.oauthService.getApp(id);
  }

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Patch('applications/:id')
  @ApiOperation({ summary: 'Update an OAuth application' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  updateApp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.oauthService.updateApp(id, body as Parameters<typeof this.oauthService.updateApp>[1]);
  }

  @ApiBearerAuth('JWT')
  @UseGuards(JwtAuthGuard)
  @Delete('applications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an OAuth application' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteApp(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.oauthService.deleteApp(id);
  }

  // -------- Authorization Endpoint --------

  @Public()
  @Get('authorize')
  @ApiOperation({
    summary: 'OAuth 2.0 Authorization Endpoint',
    description:
      'Initiates the authorization code flow. In a real implementation, this renders a consent UI. Here it auto-approves for demonstration.',
  })
  @ApiQuery({ name: 'client_id', required: true })
  @ApiQuery({ name: 'redirect_uri', required: true })
  @ApiQuery({ name: 'scope', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'code_challenge', required: false })
  @ApiQuery({ name: 'code_challenge_method', required: false, enum: ['S256', 'plain'] })
  @ApiResponse({ status: 200, description: 'Authorization code (demo — real impl would redirect)' })
  async authorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('scope') scope?: string,
    @Query('code_challenge') codeChallenge?: string,
    @Query('code_challenge_method') codeChallengeMethod?: 'S256' | 'plain',
  ) {
    // In a real impl: render consent UI, redirect with code to redirect_uri
    // For demo: auto-issue code for a stub user
    const code = await this.oauthService.createAuthorizationCode({
      clientId,
      redirectUri,
      scopes: scope ? scope.split(' ') : [],
      userId: 'demo-user-id',
      codeChallenge,
      codeChallengeMethod,
    });
    return { code, message: 'Demo: in production this would redirect to redirect_uri' };
  }

  // -------- Token Endpoint --------

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'OAuth 2.0 Token Endpoint',
    description: 'Exchange authorization codes or client credentials for access tokens (RFC 6749).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['grant_type'],
      properties: {
        grant_type: { type: 'string', enum: ['authorization_code', 'client_credentials'] },
        code: { type: 'string', description: 'Required for authorization_code grant' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        redirect_uri: { type: 'string', format: 'uri' },
        code_verifier: { type: 'string', description: 'PKCE verifier' },
        scope: { type: 'string', description: 'Space-separated scopes for client_credentials' },
      },
    },
  })
  async token(@Body(new ZodValidationPipe(tokenSchema)) dto: z.infer<typeof tokenSchema>) {
    if (dto.grant_type === 'authorization_code') {
      return this.oauthService.exchangeAuthorizationCode({
        code: dto.code,
        clientId: dto.client_id,
        clientSecret: dto.client_secret,
        redirectUri: dto.redirect_uri,
        codeVerifier: dto.code_verifier,
      });
    } else {
      return this.oauthService.clientCredentials({
        clientId: dto.client_id,
        clientSecret: dto.client_secret,
        scopes: dto.scope ? dto.scope.split(' ') : undefined,
      });
    }
  }

  // -------- Token Revocation (RFC 7009) --------

  @Public()
  @Post('token/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a token (RFC 7009)',
    description: 'Revokes an access or refresh token. Accepts both token types.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string' },
        token_type_hint: { type: 'string', enum: ['access_token', 'refresh_token'] },
      },
    },
  })
  async revokeToken(@Body() body: { token: string; token_type_hint?: string }): Promise<void> {
    await this.oauthService.revokeToken(body.token, body.token_type_hint);
  }
}
