import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { BaseRepository } from '../database/repository.base';
import {
  Project,
  ProjectRow,
  mapProjectRow,
} from './entities/project.entity';
import {
  CreateProjectDto,
  UpdateProjectDto,
} from './dto/create-project.schema';
import {
  PaginationQuery,
  encodeCursor,
  decodeCursor,
} from '../common/pagination/pagination.dto';
import {
  PaginatedResponse,
  createPaginatedResponse,
} from '../common/pagination/paginated-response';

/**
 * Projects service — manages projects scoped to organizations.
 *
 * Projects represent isolated environments within an organization (analogous
 * to Supabase projects: each gets a dedicated database endpoint).
 *
 * State machine:
 *   active ←→ paused
 *   active/paused → deleting → (background job) → deleted
 */
@Injectable()
export class ProjectsService extends BaseRepository {
  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    super(pool, ProjectsService.name);
  }

  async create(organizationId: string, dto: CreateProjectDto): Promise<Project> {
    const slug =
      dto.slug ??
      dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 63);

    return this.withTransaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM projects
         WHERE organization_id = $1 AND slug = $2 AND deleted_at IS NULL`,
        [organizationId, slug],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException({
          message: `A project with slug '${slug}' already exists in this organization`,
          code: 'ALREADY_EXISTS',
        });
      }

      const result = await client.query<ProjectRow>(
        `INSERT INTO projects (organization_id, name, slug, region, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [organizationId, dto.name, slug, dto.region, JSON.stringify(dto.metadata ?? {})],
      );

      return mapProjectRow(result.rows[0]!);
    });
  }

  async findAll(
    organizationId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<Project>> {
    const { limit, cursor } = pagination;
    const cursorPayload = cursor ? decodeCursor(cursor) : null;

    const params: unknown[] = [organizationId, limit + 1];
    let cursorWhere = '';
    let paramIdx = 3;

    if (cursorPayload) {
      cursorWhere = `AND (created_at, id) < ($${paramIdx}::timestamptz, $${paramIdx + 1}::uuid)`;
      params.push(cursorPayload.createdAt, cursorPayload.id);
      paramIdx += 2;
    }

    const [rows, countResult] = await Promise.all([
      this.query<ProjectRow>(
        `SELECT * FROM projects
         WHERE organization_id = $1 AND deleted_at IS NULL
         ${cursorWhere}
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        params,
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM projects
         WHERE organization_id = $1 AND deleted_at IS NULL`,
        [organizationId],
      ),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    const nextCursor =
      hasMore && items.length > 0
        ? encodeCursor({
            id: items[items.length - 1]!.id,
            createdAt: items[items.length - 1]!.created_at.toISOString(),
          })
        : null;

    return createPaginatedResponse(items.map(mapProjectRow), total, nextCursor);
  }

  async findOne(organizationId: string, projectId: string): Promise<Project> {
    const row = await this.queryOne<ProjectRow>(
      `SELECT * FROM projects
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [projectId, organizationId],
    );

    if (!row) {
      throw new NotFoundException({
        message: `Project '${projectId}' not found in organization '${organizationId}'`,
        code: 'NOT_FOUND',
      });
    }

    return mapProjectRow(row);
  }

  async update(
    organizationId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const current = await this.findOne(organizationId, projectId);

    if (dto.version !== undefined && dto.version !== current.version) {
      throw new ConflictException({
        message: `Optimistic concurrency conflict: expected version ${dto.version}, got ${current.version}`,
        code: 'CONFLICT',
      });
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (dto.name !== undefined) {
      updates.push(`name = $${paramIdx}`);
      params.push(dto.name);
      paramIdx++;
    }
    if (dto.metadata !== undefined) {
      updates.push(`metadata = $${paramIdx}`);
      params.push(JSON.stringify(dto.metadata));
      paramIdx++;
    }

    if (updates.length === 0) return current;

    updates.push('version = version + 1');
    params.push(projectId, organizationId);

    const row = await this.queryOne<ProjectRow>(
      `UPDATE projects
       SET ${updates.join(', ')}
       WHERE id = $${paramIdx} AND organization_id = $${paramIdx + 1} AND deleted_at IS NULL
       RETURNING *`,
      params,
    );

    if (!row) throw new NotFoundException({ message: 'Project not found', code: 'NOT_FOUND' });
    return mapProjectRow(row);
  }

  async pause(organizationId: string, projectId: string): Promise<Project> {
    const project = await this.findOne(organizationId, projectId);
    if (project.status !== 'active') {
      throw new BadRequestException({
        message: `Cannot pause a project in '${project.status}' status. Only 'active' projects can be paused.`,
        code: 'INVALID_REQUEST',
      });
    }

    const row = await this.queryOne<ProjectRow>(
      `UPDATE projects
       SET status = 'paused', version = version + 1
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [projectId, organizationId],
    );

    return mapProjectRow(row!);
  }

  async resume(organizationId: string, projectId: string): Promise<Project> {
    const project = await this.findOne(organizationId, projectId);
    if (project.status !== 'paused') {
      throw new BadRequestException({
        message: `Cannot resume a project in '${project.status}' status. Only 'paused' projects can be resumed.`,
        code: 'INVALID_REQUEST',
      });
    }

    const row = await this.queryOne<ProjectRow>(
      `UPDATE projects
       SET status = 'active', version = version + 1
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [projectId, organizationId],
    );

    return mapProjectRow(row!);
  }

  async remove(organizationId: string, projectId: string): Promise<void> {
    await this.findOne(organizationId, projectId);
    await this.query(
      `UPDATE projects
       SET deleted_at = NOW(), status = 'deleting', version = version + 1
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [projectId, organizationId],
    );
  }
}
