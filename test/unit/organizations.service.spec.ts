import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../../src/organizations/organizations.service';
import { DATABASE_POOL } from '../../src/database/database.module';

/**
 * Unit tests for OrganizationsService.
 *
 * We mock the PostgreSQL pool entirely — service tests should exercise
 * business logic, not database behaviour. Integration tests cover the SQL.
 *
 * Pattern: inject a mock pool that captures query calls, then assert on
 * the resolved entity shape and thrown exceptions.
 */

function createMockPool(responses: Array<{ rows: unknown[] }> = []) {
  let callIdx = 0;
  return {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockImplementation(async () => {
        const resp = responses[callIdx++] ?? { rows: [] };
        return resp;
      }),
      release: vi.fn(),
      [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
    }),
    query: vi.fn().mockImplementation(async () => {
      const resp = responses[callIdx++] ?? { rows: [] };
      return resp;
    }),
  };
}

function makeOrgRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Acme Corp',
    slug: 'acme-corp',
    plan: 'free',
    metadata: {},
    version: 1,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    // Reset mock state between tests
  });

  describe('create()', () => {
    it('creates an organization with a derived slug when none is provided', async () => {
      const pool = createMockPool([
        // BEGIN
        { rows: [] },
        // SELECT id WHERE slug conflict check — empty (no conflict)
        { rows: [] },
        // INSERT RETURNING
        { rows: [makeOrgRow()] },
        // COMMIT
        { rows: [] },
      ]);

      service = new OrganizationsService(pool as never);

      const result = await service.create({ name: 'Acme Corp', plan: 'free', metadata: {} });

      expect(result.name).toBe('Acme Corp');
      expect(result.slug).toBe('acme-corp');
      expect(result.plan).toBe('free');
    });

    it('throws ConflictException when slug already exists', async () => {
      const pool = createMockPool([
        { rows: [] },    // BEGIN
        { rows: [{ id: 'existing-id' }] }, // slug conflict
        { rows: [] },    // ROLLBACK
      ]);

      service = new OrganizationsService(pool as never);

      await expect(
        service.create({ name: 'Acme Corp', slug: 'acme-corp', plan: 'free', metadata: {} }),
      ).rejects.toThrow(ConflictException);
    });

    it('uses a custom slug when provided', async () => {
      const orgRow = makeOrgRow({ slug: 'my-custom-slug' });
      const pool = createMockPool([
        { rows: [] },      // BEGIN
        { rows: [] },      // slug check — no conflict
        { rows: [orgRow] }, // INSERT RETURNING
        { rows: [] },      // COMMIT
      ]);

      service = new OrganizationsService(pool as never);

      const result = await service.create({
        name: 'Acme Corp',
        slug: 'my-custom-slug',
        plan: 'free',
        metadata: {},
      });

      expect(result.slug).toBe('my-custom-slug');
    });
  });

  describe('findOne()', () => {
    it('returns the organization when found', async () => {
      const pool = createMockPool([{ rows: [makeOrgRow()] }]);
      service = new OrganizationsService(pool as never);

      const result = await service.findOne('123e4567-e89b-12d3-a456-426614174000');
      expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('throws NotFoundException when organization does not exist', async () => {
      const pool = createMockPool([{ rows: [] }]);
      service = new OrganizationsService(pool as never);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update()', () => {
    it('updates the name and returns the updated entity', async () => {
      const original = makeOrgRow();
      const updated = makeOrgRow({ name: 'New Name', version: 2 });
      const pool = createMockPool([
        { rows: [original] }, // findOne
        { rows: [updated] },  // UPDATE RETURNING
      ]);

      service = new OrganizationsService(pool as never);

      const result = await service.update('123e4567-e89b-12d3-a456-426614174000', {
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
      expect(result.version).toBe(2);
    });

    it('throws ConflictException on version mismatch', async () => {
      const original = makeOrgRow({ version: 3 });
      const pool = createMockPool([{ rows: [original] }]);
      service = new OrganizationsService(pool as never);

      await expect(
        service.update('123e4567-e89b-12d3-a456-426614174000', { version: 1 }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns the current entity unchanged when no updates are provided', async () => {
      const original = makeOrgRow();
      const pool = createMockPool([{ rows: [original] }]);
      service = new OrganizationsService(pool as never);

      const result = await service.update('123e4567-e89b-12d3-a456-426614174000', {});

      expect(result.name).toBe('Acme Corp');
    });
  });

  describe('remove()', () => {
    it('soft-deletes the organization', async () => {
      const pool = createMockPool([
        { rows: [makeOrgRow()] }, // findOne
        { rows: [] },             // UPDATE deleted_at
      ]);

      service = new OrganizationsService(pool as never);

      await expect(
        service.remove('123e4567-e89b-12d3-a456-426614174000'),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException if organization does not exist', async () => {
      const pool = createMockPool([{ rows: [] }]);
      service = new OrganizationsService(pool as never);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
