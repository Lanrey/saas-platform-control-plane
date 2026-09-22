import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { loginSchema, LoginDto, refreshTokenSchema } from './dto/token.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue access + refresh tokens',
    description: 'Authenticate with email/password and receive a JWT access token (15m) and refresh token (7d).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email', example: 'user@example.com' },
        password: { type: 'string', minLength: 8, example: 'supersecret' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token pair issued',
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string', description: 'RS256 JWT, 15 minute TTL' },
        refreshToken: { type: 'string', description: 'Opaque refresh token, 7 day TTL' },
        tokenType: { type: 'string', example: 'Bearer' },
        expiresIn: { type: 'integer', description: 'Access token TTL in seconds', example: 900 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Exchange a refresh token for a new token pair. The refresh token is rotated (single-use).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken'],
      properties: {
        refreshToken: { type: 'string', example: 'rt_...' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 401, description: 'Refresh token expired or invalid' })
  refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: { refreshToken: string },
  ) {
    return this.authService.refreshTokens(body.refreshToken);
  }
}
