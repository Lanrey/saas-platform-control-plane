export type ApiKeyType = 'sandbox' | 'production';

export interface ApiKey {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;    // First 12 chars — shown in UI for identification
  keyType: ApiKeyType;
  rateLimitRpm: number;
  rateLimitRpd: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Full API key — only returned at creation time, never stored */
export interface ApiKeyWithSecret extends ApiKey {
  key: string;  // plaintext key — ONLY returned once at creation
}

export interface ApiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  key_type: string;
  rate_limit_rpm: number;
  rate_limit_rpd: number;
  last_used_at: Date | null;
  expires_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export function mapApiKeyRow(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyType: row.key_type as ApiKeyType,
    rateLimitRpm: row.rate_limit_rpm,
    rateLimitRpd: row.rate_limit_rpd,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
