# Platform Management API

A production-grade multi-tenant control plane for managing organizations, projects, API keys, and OAuth applications. Built as a showcase for Supabase's API Engineer role — this architecture mirrors the exact problem Supabase's Management API solves.

## What problem it solves

SaaS platforms need a programmatic control plane: a way for customers to manage their tenants, issue credentials, and register integrations without clicking through a UI. This API provides that control plane with:

- **Multi-tenancy**: Organizations as the top-level grouping unit, with role-based membership
- **Project lifecycle**: Create isolated project environments, pause/resume them
- **Credential management**: API keys with per-key rate limits, rotation, and revocation
- **OAuth 2.0**: Authorization Code + Client Credentials flows for third-party integrations
- **Observability**: Structured logging, Prometheus metrics, health probes

## Architecture decisions

### NestJS over Express/Fastify raw
NestJS with the Fastify adapter gives us: dependency injection (makes testing trivial — swap real DB for mocks without monkey-patching), a module system that mirrors the service boundaries, OpenAPI generation from decorators, and a clear separation between controllers (HTTP concerns) and services (business logic). Fastify as the HTTP adapter delivers ~2x the throughput of Express with lower latency tails.

### Direct SQL over ORM
We use `pg` Pool directly with hand-written SQL migrations rather than TypeORM or Prisma. Reasons:
- SQL migrations are the unambiguous schema source of truth — no surprises from ORM auto-generation
- Full control over query plans, indexes, and transaction semantics
- No N+1 footguns from lazy-loading associations
- Migrations are portable — any PostgreSQL-compatible tool can apply them

### TypeScript 5.x features

| Feature | Where used | Why |
|---------|-----------|-----|
| `const` type parameters (TS 5.0) | `createPaginatedResponse`, `createEndpoint` | Preserves literal types through generic boundaries without manual type assertions |
| `satisfies` operator (TS 4.9+) | `app.config.ts`, `database.config.ts` | Type-check config objects against an interface without widening to `object` — catches extra properties at compile time |
| `using` keyword / `Symbol.asyncDispose` (TS 5.2) | `repository.base.ts` — `withTransaction`, `query` | Guarantees database connections are released even when exceptions are thrown mid-function. Replaces manual try/finally patterns that are easy to get wrong |
| `NoInfer<T>` (TS 5.4) | `PaginatedFetcher<T>` type in `paginated-response.ts` | Prevents the return type from being inferred from the call site — forces callers to be explicit about T, avoiding silent widening |
| Template literal types | Route types in controllers | `type ApiRoute = \`/v1/\${string}\`` catches mistyped route prefixes at compile time |
| Variadic tuple types | Middleware chain types | Compose multiple middleware types into a typed tuple that preserves order and individual types |

### RS256 over HS256 for JWTs
HS256 uses a shared secret: any service that can verify tokens can also forge them. In microservices, this means every service that needs to verify JWTs also becomes a potential token issuer — a security liability. RS256 uses asymmetric keys: the auth service holds the private key (signs), and other services only receive the public key (verify only). Rotating the key pair doesn't require coordinating a shared secret across services.

### Cursor-based over offset pagination

Offset pagination has two serious flaws at scale:

1. **Performance**: `OFFSET 100000 LIMIT 20` requires scanning and discarding 100,000 rows. PostgreSQL can't use an index to jump directly to row 100,000.
2. **Consistency**: Rows inserted or deleted between page requests cause "ghost rows" (same row appearing twice) or "row skips" (rows never appearing).

Cursor pagination uses `WHERE (created_at, id) < ($cursor_created_at, $cursor_id) ORDER BY created_at DESC, id DESC LIMIT N`. This uses the primary key index, runs in O(log N) regardless of page position, and is stable under concurrent mutations.

The cursor is base64url-encoded JSON: `{ id, createdAt }`. We use base64url (RFC 4648 §5) rather than standard base64 so the cursor is safe in query strings without percent-encoding.

### RFC 9457 Problem Details for errors
A single error format across all endpoints makes client error handling predictable. RFC 9457 is the IETF standard for HTTP API error responses — it's what mature APIs (Stripe, Cloudflare, GitHub) converge to. The `type` URI is machine-readable, `title` is human-readable, `traceId` threads correlation IDs from the `X-Request-ID` header through to logs.

### Rate limiting — sliding window algorithm
We use a sliding window counter rather than a fixed window. Fixed windows have a burst problem: a client can use their entire quota in the last second of window N and the first second of window N+1, effectively doubling the limit at the boundary. Sliding windows amortize this correctly. The window state is stored in Redis with atomic `INCR` + `EXPIREAT` commands.

## Getting started

### Prerequisites
- Node.js 20+
- Docker + Docker Compose
- `openssl` (for generating JWT key pair)

### Generate RSA keys

```bash
mkdir -p keys
# Generate 2048-bit private key
openssl genrsa -out keys/private.pem 2048
# Extract public key
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
# Base64-encode for Docker/cloud (no newlines)
export JWT_PRIVATE_KEY_BASE64=$(base64 -w0 keys/private.pem)
export JWT_PUBLIC_KEY_BASE64=$(base64 -w0 keys/public.pem)
```

### Local setup with Docker Compose

```bash
# Clone and install dependencies
npm install

# Copy env file
cp .env.example .env
# Edit .env with your DB passwords and JWT keys

# Start all services (app + postgres + redis)
docker-compose up -d

# Apply migrations
npm run db:migrate

# Verify it's running
curl http://localhost:3000/health
# {"status":"ok","info":{"application":{"status":"up"}},...}
```

### Development mode (hot reload)

```bash
# Start infrastructure only
docker-compose up -d postgres redis

# Run app in dev mode
npm run start:dev

# OpenAPI docs at:
open http://localhost:3000/docs
```

### Running tests

```bash
# Unit tests (no DB required)
npm test

# Unit tests with coverage
npm run test:cov

# Integration tests (requires test DB)
docker-compose -f docker-compose.test.yml up -d
npm run test:e2e

# Clean up
docker-compose -f docker-compose.test.yml down -v
```

## API reference

Interactive Swagger UI is available at `http://localhost:3000/docs` when running locally.

### Quick curl examples

**Create an organization**
```bash
curl -X POST http://localhost:3000/v1/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "plan": "pro"}'
```

**List organizations (cursor paginated)**
```bash
# First page
curl "http://localhost:3000/v1/organizations?limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Next page (use nextCursor from meta)
curl "http://localhost:3000/v1/organizations?limit=10&cursor=eyJpZCI6Ii4..." \
  -H "Authorization: Bearer $TOKEN"
```

**Create an API key**
```bash
curl -X POST http://localhost:3000/v1/organizations/$ORG_ID/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "CI/CD", "keyType": "production"}'
# → {"key": "pmk_...", ...}  ← save this, shown once
```

**Authenticate with API key**
```bash
curl http://localhost:3000/v1/organizations/$ORG_ID/projects \
  -H "X-API-Key: pmk_..."
```

**OAuth client credentials flow**
```bash
curl -X POST http://localhost:3000/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "app_...",
    "client_secret": "cs_..."
  }'
```

**Check rate limit headers**
```bash
curl -v http://localhost:3000/v1/organizations \
  -H "X-API-Key: pmk_..."
# X-RateLimit-Limit: 60
# X-RateLimit-Remaining: 59
# X-RateLimit-Reset: 1709900460
```

## Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /v1/auth/token | Issue JWT access + refresh tokens |
| POST | /v1/auth/refresh | Refresh token rotation |
| POST | /v1/organizations | Create organization |
| GET | /v1/organizations | List (cursor paginated) |
| PATCH | /v1/organizations/:id | Update (optimistic concurrency) |
| DELETE | /v1/organizations/:id | Soft delete |
| POST | /v1/organizations/:id/members | Add member |
| POST | /v1/organizations/:orgId/projects | Create project |
| POST | /v1/organizations/:orgId/projects/:id/pause | Pause project |
| POST | /v1/organizations/:orgId/projects/:id/resume | Resume project |
| POST | /v1/organizations/:orgId/api-keys | Create API key (plaintext returned once) |
| DELETE | /v1/organizations/:orgId/api-keys/:id | Revoke key |
| POST | /v1/organizations/:orgId/api-keys/:id/rotate | Rotate key |
| GET | /v1/oauth/authorize | Authorization Code endpoint |
| POST | /v1/oauth/token | Token endpoint (auth_code + client_credentials) |
| POST | /v1/oauth/token/revoke | Token revocation (RFC 7009) |
| GET | /health | Liveness probe |
| GET | /health/ready | Readiness probe (DB connectivity) |
| GET | /metrics | Prometheus metrics |

## Production considerations

### Connection pooling
The `pg.Pool` is configured with `min=2` (warm connections kept alive during idle) and `max=20` (prevents exhausting PostgreSQL's default 100-connection limit when running multiple app instances). `statement_timeout` (30s) and `idle_in_transaction_session_timeout` (60s) prevent runaway queries and transaction locks.

### Graceful shutdown
`SIGTERM` and `SIGINT` handlers call `app.close()`, which drains in-flight requests before closing the HTTP server and database pool. This is critical for zero-downtime rolling deploys in Kubernetes — without it, active requests get hard-terminated when a pod is replaced.

### Observability hooks
- **Structured logging**: pino with JSON output in production. Every log line includes `requestId` (from `X-Request-ID`), `method`, `url`, `status`, `durationMs`. Sensitive fields (`Authorization`, `X-API-Key`, passwords) are redacted.
- **Metrics**: Prometheus-format endpoint at `/metrics`. In production, configure your Prometheus scrape config to target `:3000/metrics` and set up Grafana dashboards for `http_request_duration_seconds` and `api_key_validations_total`.
- **Health probes**: `/health` (liveness — is the process running?) and `/health/ready` (readiness — can we serve traffic?). Configure Kubernetes to use these appropriately.

### API key security
- 32 bytes of `crypto.randomBytes` → base64url encoded → 43 chars of entropy
- SHA-256 hash stored; plaintext never persisted
- Timing-safe comparison (`timingSafeEqual`) during validation
- `last_used_at` updated asynchronously (non-blocking)
- Rotation is atomic: revoke old, insert new in a single transaction

### Database schema patterns
- **Soft deletes** (`deleted_at`): enables audit trails; all queries filter `WHERE deleted_at IS NULL`
- **Optimistic concurrency** (`version` column): incremented on every UPDATE; callers pass the version they read; mismatch → 409 Conflict
- **Row-level scoping**: `organization_id` on every tenant table; enforced in queries, ready for PostgreSQL RLS policies
- **Indexed foreign keys**: every `organization_id` FK has an index; `(created_at, id)` composite index supports cursor pagination ORDER BY

## TypeScript patterns

### `const` type parameters (TS 5.0) — `src/common/pagination/paginated-response.ts`
```typescript
function createPaginatedResponse<const T>(data: T[], ...): PaginatedResponse<T>
```
Without `const`, calling `createPaginatedResponse(['a', 'b'])` would widen `T` to `string`. With `const`, the literal tuple `['a', 'b']` is preserved. Useful in test code where you want exact type narrowing.

### `satisfies` operator — `src/config/app.config.ts`
```typescript
return parsed.data satisfies AppConfig;
```
`satisfies` checks the type without widening. If we wrote `return parsed.data as AppConfig`, we'd lose any excess properties. With `satisfies`, TypeScript ensures the shape matches AND keeps the inferred type narrow.

### `using` keyword (TS 5.2) — `src/database/repository.base.ts`
```typescript
await using releasable = new ReleasableClient(await this.pool.connect());
// client.release() called automatically when block exits — even on throw
```
This is the Resource Management pattern (TC39 Explicit Resource Management). The `[Symbol.asyncDispose]` method on `ReleasableClient` is called automatically when the `using` binding goes out of scope. Replaces brittle try/finally patterns where `client.release()` could be accidentally omitted in error paths.

### `NoInfer<T>` (TS 5.4) — `src/common/pagination/paginated-response.ts`
```typescript
type PaginatedFetcher<T> = (limit: number, cursor: string | undefined)
  => Promise<PaginatedResponse<NoInfer<T>>>;
```
`NoInfer<T>` prevents TypeScript from inferring `T` from the return type. Callers must explicitly provide `T` — this prevents accidental widening when the return value's type is broader than intended.

### Template literal types — `src/common/pagination/pagination.dto.ts`
```typescript
type ApiRoute = `/v1/${string}`;
type ResourceRoute<R extends string> = `/v1/${R}` | `/v1/${R}/${string}`;
```
These types enforce the `/v1/` prefix at compile time. A typo like `'/v1organizations'` fails to assignto `ApiRoute`, caught before runtime.

---

Built with TypeScript 5.x, NestJS, PostgreSQL, Vitest, Zod, and Docker.
