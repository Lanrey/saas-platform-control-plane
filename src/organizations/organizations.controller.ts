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
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createOrgSchema, CreateOrgDto } from './dto/create-org.schema';
import { updateOrgSchema, UpdateOrgDto } from './dto/update-org.schema';
import { paginationSchema, PaginationQueryDto } from '../common/pagination/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';

/**
 * Organizations controller — REST API for multi-tenant organization management.
 *
 * Template literal types (TS 5.x): The route paths are typed as
 * `\`/v1/organizations${string}\`` — the compiler catches typos in path
 * parameters at build time when used with our typed route helpers.
 */
@ApiTags('Organizations')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an organization',
    description: 'Creates a new organization. The authenticated user becomes the owner.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', example: 'Acme Corp', minLength: 2, maxLength: 100 },
        slug: { type: 'string', example: 'acme-corp', pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$' },
        plan: { type: 'string', enum: ['free', 'pro', 'enterprise'], default: 'free' },
        metadata: { type: 'object', additionalProperties: true },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Organization created successfully' })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  create(
    @Body(new ZodValidationPipe(createOrgSchema)) dto: CreateOrgDto,
  ) {
    return this.organizationsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List organizations',
    description: 'Returns a cursor-paginated list of organizations.',
  })
  @ApiQuery({ type: PaginationQueryDto })
  @ApiQuery({
    name: 'plan',
    required: false,
    enum: ['free', 'pro', 'enterprise'],
    description: 'Filter by plan',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of organizations' })
  findAll(
    @Query(new ZodValidationPipe(paginationSchema)) pagination: { limit: number; cursor?: string },
    @Query('plan') plan?: string,
  ) {
    return this.organizationsService.findAll(pagination, { plan });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization found' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an organization' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 100 },
        plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
        metadata: { type: 'object', additionalProperties: true },
        version: { type: 'integer', minimum: 1, description: 'For optimistic concurrency control' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Organization updated' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({ status: 409, description: 'Optimistic concurrency conflict' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOrgSchema)) dto: UpdateOrgDto,
  ) {
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an organization',
    description: 'Soft-deletes the organization. Projects and API keys are not immediately removed.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Organization deleted' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.organizationsService.remove(id);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a member to an organization' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Organization ID' })
  @ApiResponse({ status: 201, description: 'Member added' })
  @ApiResponse({ status: 409, description: 'User is already a member' })
  addMember(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() body: { userId: string; role?: 'owner' | 'admin' | 'member' | 'viewer' },
    @CurrentUser() user: JwtUser,
  ) {
    return this.organizationsService.addMember(
      organizationId,
      body.userId,
      body.role ?? 'member',
      user.sub,
    );
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List organization members' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Organization ID' })
  @ApiResponse({ status: 200, description: 'List of members' })
  listMembers(@Param('id', ParseUUIDPipe) organizationId: string) {
    return this.organizationsService.listMembers(organizationId);
  }
}
