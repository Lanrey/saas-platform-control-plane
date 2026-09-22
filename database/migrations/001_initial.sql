-- ============================================================
-- Platform Management API — Initial Schema
-- Migration: 001_initial.sql
-- ============================================================
-- Design decisions:
-- 1. UUID primary keys: globally unique without coordination; safe for
--    distributed inserts and safe to expose in URLs.
-- 2. Soft deletes (deleted_at): enables audit trails and referential
--    integrity without cascading hard deletes. All queries filter
--    WHERE deleted_at IS NULL.
-- 3. Optimistic concurrency (version column): incremented on every UPDATE.
--    Callers pass ?version=N; if version mismatch → 409 Conflict. Prevents
--    lost-update bugs in concurrent edits without serializable isolation.
-- 4. Row-level security pattern: org_id on every tenant-scoped table.
--    Enforced at the application layer; enables RLS policies on top.
-- 5. created_at/updated_at: server-side defaults, updated by trigger.
-- ============================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Helper: auto-update updated_at on every row mutation
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users (email) WHERE deleted_at IS NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Organizations
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  metadata    JSONB NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_orgs_slug ON organizations (slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_orgs_created_at ON organizations (created_at) WHERE deleted_at IS NULL;

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Organization Members  (junction table)
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_members_org_id   ON organization_members (organization_id);
CREATE INDEX idx_org_members_user_id  ON organization_members (user_id);

CREATE TRIGGER org_members_set_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'deleting', 'deleted')),
  region          TEXT NOT NULL DEFAULT 'us-east-1',
  database_host   TEXT,
  database_port   INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}',
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, slug)
);

CREATE INDEX idx_projects_org_id      ON projects (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_status      ON projects (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_created_at  ON projects (created_at) WHERE deleted_at IS NULL;

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- API Keys
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,  -- SHA-256 of plaintext key; never store plaintext
  key_prefix      TEXT NOT NULL,         -- First 12 chars of plaintext for display
  key_type        TEXT NOT NULL DEFAULT 'sandbox' CHECK (key_type IN ('sandbox', 'production')),
  rate_limit_rpm  INTEGER NOT NULL DEFAULT 60,
  rate_limit_rpd  INTEGER NOT NULL DEFAULT 10000,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ             -- soft delete = revoked
);

CREATE INDEX idx_api_keys_org_id    ON api_keys (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_api_keys_key_hash  ON api_keys (key_hash) WHERE deleted_at IS NULL;

CREATE TRIGGER api_keys_set_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- OAuth Applications
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_applications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  client_id         TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,  -- SHA-256 of plaintext secret
  redirect_uris     TEXT[] NOT NULL DEFAULT '{}',
  scopes            TEXT[] NOT NULL DEFAULT '{}',
  grant_types       TEXT[] NOT NULL DEFAULT '{authorization_code}',
  -- Public clients (SPAs, mobile) don't have a secret and use PKCE
  is_public         BOOLEAN NOT NULL DEFAULT false,
  logo_url          TEXT,
  website_url       TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_oauth_apps_client_id    ON oauth_applications (client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_oauth_apps_org_id       ON oauth_applications (organization_id) WHERE deleted_at IS NULL;

CREATE TRIGGER oauth_apps_set_updated_at
  BEFORE UPDATE ON oauth_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- OAuth Authorization Codes (short-lived, single-use)
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  client_id       TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  code_challenge  TEXT,
  code_challenge_method TEXT CHECK (code_challenge_method IN ('S256', 'plain')),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,  -- marks single-use consumption
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_codes_code     ON oauth_authorization_codes (code);
CREATE INDEX idx_oauth_codes_expires  ON oauth_authorization_codes (expires_at);

-- ============================================================
-- OAuth Access Tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,  -- SHA-256
  client_id       TEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  token_type      TEXT NOT NULL DEFAULT 'Bearer',
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_tokens_hash    ON oauth_access_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_oauth_tokens_expires ON oauth_access_tokens (expires_at) WHERE revoked_at IS NULL;

-- ============================================================
-- OAuth Refresh Tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  access_token_id UUID NOT NULL REFERENCES oauth_access_tokens(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_refresh_hash ON oauth_refresh_tokens (token_hash) WHERE revoked_at IS NULL;

-- ============================================================
-- Schema Migrations Tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001_initial')
  ON CONFLICT DO NOTHING;
