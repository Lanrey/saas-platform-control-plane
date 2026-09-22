import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { BaseRepository } from '../database/repository.base';
import {
  Organization,
  OrganizationMember,
  OrganizationRow,
  OrganizationMemberRow,
  mapOrganizationRow,
  mapMemberRow,
} from './entities/organization.entity';
import { CreateOrgDto, slugifyName } from './dto/create-org.schema';
import { UpdateOrgDto } from './dto/update-org.schema';
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
 * Organizations service — business logic for multi-tenant organization management.
 *
 * All queries include `deleted_at IS NULL` to respect soft deletes.
 * Cursor-based pagination uses `(created_at, id)` composite cursor for
 * stable ordering — ties in created_at are broken by id.
 */
@Injectable()
export class OrganizationsService extends BaseRepository {
  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    super(pool, OrganizationsService.name);
  }

  /**
   * Create a new organization.
   * Derives slug from name if not provided; errors on duplicate slug.
   */
  async create(dto: CreateOrgDto): Promise<Organization> {
    const slug = dto.slug ?? slugifyName(dto.name);

    return this.withTransaction(async (client) => {
      // Check slug uniqueness (soft-deleted orgs don't block slug reuse)
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM organizations WHERE slug = $1 AND deleted_at IS NULL`,
        [slug],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException({
          message: `An organization with slug '${slug}' already exists`,
          code: 'ALREADY_EXISTS',
        });
      }

      const result = await client.query<OrganizationRow>(
        `INSERT INTO organizations (name, slug, plan, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [dto.name, slug, dto.plan ?? 'free', JSON.stringify(dto.metadata ?? {})],
      );

      return mapOrganizationRow(result.rows[0]!);
    });
  }

  /**
   * List organizations with cursor-based pagination.
   * Supports filtering by plan.
   */
  async findAll(
    pagination: PaginationQuery,
    filters?: { plan?: string },
  ): Promise<PaginatedResponse<Organization>> {
    const { limit, cursor } = pagination;
    const cursorPayload = cursor ? decodeCursor(cursor) : null;

    const params: unknown[] = [limit + 1]; // fetch one extra to determine hasMore
    let whereClause = 'WHERE deleted_at IS NULL';
    let paramIdx = 2;

    if (cursorPayload) {
      whereClause += ` AND (created_at, id) < ($${paramIdx}::timestamptz, $${paramIdx + 1}::uuid)`;
      params.push(cursorPayload.createdAt, cursorPayload.id);
      paramIdx += 2;
    }

    if (filters?.plan) {
      whereClause += ` AND plan = $${paramIdx}`;
      params.push(filters.plan);
      paramIdx++;
    }

    const [rows, countResult] = await Promise.all([
      this.query<OrganizationRow>(
        `SELECT * FROM organizations
         ${whereClause}
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        params,
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM organizations WHERE deleted_at IS NULL${
          filters?.plan ? ` AND plan = '${filters.plan}'` : ''
        }`,
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

    return createPaginatedResponse(items.map(mapOrganizationRow), total, nextCursor);
  }

  /**
   * Find an organization by ID.
   * Throws NotFoundException if not found or soft-deleted.
   */
  async findOne(id: string): Promise<Organization> {
    const row = await this.queryOne<OrganizationRow>(
      `SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );

    if (!row) {
      throw new NotFoundException({
        message: `Organization with id '${id}' was not found`,
        code: 'NOT_FOUND',
      });
    }

    return mapOrganizationRow(row);
  }

  /**
   * Update an organization with optimistic concurrency control.
   * If version is provided and doesn't match, throws 409 Conflict.
   */
  async update(id: string, dto: UpdateOrgDto): Promise<Organization> {
    const current = await this.findOne(id);

    if (dto.version !== undefined && dto.version !== current.version) {
      throw new ConflictException({
        message: `Optimistic concurrency conflict: expected version ${dto.version}, current is ${current.version}`,
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
    if (dto.plan !== undefined) {
      updates.push(`plan = $${paramIdx}`);
      params.push(dto.plan);
      paramIdx++;
    }
    if (dto.metadata !== undefined) {
      updates.push(`metadata = $${paramIdx}`);
      params.push(JSON.stringify(dto.metadata));
      paramIdx++;
    }

    if (updates.length === 0) {
      return current;
    }

    // Increment version for optimistic concurrency
    updates.push(`version = version + 1`);
    params.push(id);

    const row = await this.queryOne<OrganizationRow>(
      `UPDATE organizations
       SET ${updates.join(', ')}
       WHERE id = $${paramIdx} AND deleted_at IS NULL
       RETURNING *`,
      params,
    );

    if (!row) {
      throw new NotFoundException({
        message: `Organization with id '${id}' was not found`,
        code: 'NOT_FOUND',
      });
    }

    return mapOrganizationRow(row);
  }

  /**
   * Soft delete an organization.
   * Sets deleted_at to NOW() — does not physically remove the row.
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id); // ensures it exists

    await this.query(
      `UPDATE organizations
       SET deleted_at = NOW(), version = version + 1
       WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
  }

  // -------- Members --------

  async addMember(
    organizationId: string,
    userId: string,
    role: OrganizationMember['role'],
    invitedBy?: string,
  ): Promise<OrganizationMember> {
    await this.findOne(organizationId); // ensure org exists

    return this.withTransaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException({
          message: 'User is already a member of this organization',
          code: 'ALREADY_EXISTS',
        });
      }

      const result = await client.query<OrganizationMemberRow>(
        `INSERT INTO organization_members (organization_id, user_id, role, invited_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [organizationId, userId, role, invitedBy ?? null],
      );

      return mapMemberRow(result.rows[0]!);
    });
  }

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    await this.findOne(organizationId);

    const rows = await this.query<OrganizationMemberRow>(
      `SELECT om.* FROM organization_members om
       JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
       WHERE om.organization_id = $1
       ORDER BY om.created_at ASC`,
      [organizationId],
    );

    return rows.map(mapMemberRow);
  }
}
