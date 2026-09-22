/**
 * Organization entity — represents a tenant in the multi-tenant platform.
 *
 * Organizations are the top-level grouping unit. Every project, API key,
 * and OAuth application belongs to exactly one organization.
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  metadata: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Database row shape (snake_case) — mapped to camelCase entity by repository */
export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  metadata: Record<string, unknown>;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface OrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Maps a DB row to the entity type */
export function mapOrganizationRow(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan as Organization['plan'],
    metadata: row.metadata,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapMemberRow(row: OrganizationMemberRow): OrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role as OrganizationMember['role'],
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
