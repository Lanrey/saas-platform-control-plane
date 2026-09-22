import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  keyType: z.enum(['sandbox', 'production']).default('sandbox'),
  rateLimitRpm: z.number().int().min(1).max(10000).optional(),
  rateLimitRpd: z.number().int().min(1).max(1000000).optional(),
  expiresAt: z.coerce.date().optional(),
});

type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;

@ApiTags('API Keys')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an API key',
    description:
      'Creates a new API key for the organization. **The plaintext key is returned ONCE** and cannot be retrieved again. Store it securely immediately.',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', example: 'CI/CD Pipeline Key' },
        keyType: { type: 'string', enum: ['sandbox', 'production'], default: 'sandbox' },
        rateLimitRpm: { type: 'integer', minimum: 1, maximum: 10000 },
        rateLimitRpd: { type: 'integer', minimum: 1, maximum: 1000000 },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'API key created. The `key` field is the plaintext key — save it now, it will not be shown again.',
  })
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(createApiKeySchema)) dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(orgId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List API keys',
    description: 'Lists all active API keys for the organization. Plaintext keys are never returned.',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'List of API keys (no plaintext values)' })
  findAll(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.apiKeysService.findAll(orgId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'API Key ID' })
  @ApiResponse({ status: 204, description: 'API key revoked' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async revoke(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.apiKeysService.revoke(orgId, id);
  }

  @Post(':id/rotate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Rotate an API key',
    description:
      'Atomically revokes the existing key and issues a new one. **The new plaintext key is returned ONCE.**',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'API Key ID to rotate' })
  @ApiResponse({ status: 201, description: 'Rotated key (new plaintext key returned once)' })
  rotate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apiKeysService.rotate(orgId, id);
  }
}
