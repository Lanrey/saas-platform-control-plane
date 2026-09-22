export interface OAuthApplication {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  clientId: string;
  redirectUris: string[];
  scopes: string[];
  grantTypes: string[];
  isPublic: boolean;
  logoUrl: string | null;
  websiteUrl: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface OAuthApplicationRow {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  client_id: string;
  client_secret_hash: string;
  redirect_uris: string[];
  scopes: string[];
  grant_types: string[];
  is_public: boolean;
  logo_url: string | null;
  website_url: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export function mapOAuthAppRow(row: OAuthApplicationRow): OAuthApplication {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    clientId: row.client_id,
    redirectUris: row.redirect_uris,
    scopes: row.scopes,
    grantTypes: row.grant_types,
    isPublic: row.is_public,
    logoUrl: row.logo_url,
    websiteUrl: row.website_url,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
