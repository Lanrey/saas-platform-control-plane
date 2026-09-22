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
  ApiResponse,
} from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createProjectSchema,
  CreateProjectDto,
  updateProjectSchema,
  UpdateProjectDto,
} from './dto/create-project.schema';
import {
  paginationSchema,
  PaginationQueryDto,
} from '../common/pagination/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Projects')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a project within an organization' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid', description: 'Organization ID' })
  @ApiResponse({ status: 201, description: 'Project created' })
  @ApiResponse({ status: 409, description: 'Slug conflict' })
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectDto,
  ) {
    return this.projectsService.create(orgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List projects for an organization' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query(new ZodValidationPipe(paginationSchema)) pagination: { limit: number; cursor?: string },
  ) {
    return this.projectsService.findAll(orgId, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by ID' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'Project found' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.findOne(orgId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(orgId, id, dto);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause an active project' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Project paused' })
  @ApiResponse({ status: 400, description: 'Project is not in active status' })
  pause(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.pause(orgId, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused project' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Project resumed' })
  @ApiResponse({ status: 400, description: 'Project is not in paused status' })
  resume(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.resume(orgId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a project',
    description: 'Soft-deletes the project and transitions it to "deleting" status.',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Project scheduled for deletion' })
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.projectsService.remove(orgId, id);
  }
}
