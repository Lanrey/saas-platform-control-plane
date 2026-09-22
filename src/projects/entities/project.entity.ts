export type ProjectStatus = 'active' | 'paused' | 'deleting' | 'deleted';

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  region: string;
  databaseHost: string | null;
  databasePort: number | null;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  status: string;
  region: string;
  database_host: string | null;
  database_port: number | null;
  metadata: Record<string, unknown>;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status as ProjectStatus,
    region: row.region,
    databaseHost: row.database_host,
    databasePort: row.database_port,
    metadata: row.metadata,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
