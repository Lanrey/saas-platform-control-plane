import { describe, it, expect, vi } from 'vitest';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ProjectsService } from '../../src/projects/projects.service';

function makeProjectRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proj-uuid-1',
    organization_id: 'org-uuid-1',
    name: 'My Project',
    slug: 'my-project',
    status: 'active',
    region: 'us-east-1',
    database_host: null,
    database_port: null,
    metadata: {},
    version: 1,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

function createMockPool(responses: Array<{ rows: unknown[] }> = []) {
  let callIdx = 0;
  return {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockImplementation(async () => responses[callIdx++] ?? { rows: [] }),
      release: vi.fn(),
      [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
    }),
    query: vi.fn().mockImplementation(async () => responses[callIdx++] ?? { rows: [] }),
  };
}

describe('ProjectsService', () => {
  describe('create()', () => {
    it('creates a project with derived slug', async () => {
      const pool = createMockPool([
        { rows: [] },                 // BEGIN
        { rows: [] },                 // slug conflict check — empty
        { rows: [makeProjectRow()] }, // INSERT RETURNING
        { rows: [] },                 // COMMIT
      ]);

      const service = new ProjectsService(pool as never);
      const result = await service.create('org-uuid-1', {
        name: 'My Project',
        region: 'us-east-1',
        metadata: {},
      });

      expect(result.name).toBe('My Project');
      expect(result.organizationId).toBe('org-uuid-1');
    });

    it('throws ConflictException when slug exists in the org', async () => {
      const pool = createMockPool([
        { rows: [] },                         // BEGIN
        { rows: [{ id: 'existing' }] },       // slug conflict
        { rows: [] },                         // ROLLBACK
      ]);

      const service = new ProjectsService(pool as never);

      await expect(
        service.create('org-uuid-1', {
          name: 'My Project',
          slug: 'my-project',
          region: 'us-east-1',
          metadata: {},
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('pause()', () => {
    it('pauses an active project', async () => {
      const pool = createMockPool([
        { rows: [makeProjectRow({ status: 'active' })] }, // findOne
        { rows: [makeProjectRow({ status: 'paused' })] }, // UPDATE
      ]);

      const service = new ProjectsService(pool as never);
      const result = await service.pause('org-uuid-1', 'proj-uuid-1');

      expect(result.status).toBe('paused');
    });

    it('throws BadRequestException when project is already paused', async () => {
      const pool = createMockPool([
        { rows: [makeProjectRow({ status: 'paused' })] }, // findOne
      ]);

      const service = new ProjectsService(pool as never);

      await expect(service.pause('org-uuid-1', 'proj-uuid-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when project is in deleting status', async () => {
      const pool = createMockPool([
        { rows: [makeProjectRow({ status: 'deleting' })] },
      ]);

      const service = new ProjectsService(pool as never);

      await expect(service.pause('org-uuid-1', 'proj-uuid-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resume()', () => {
    it('resumes a paused project', async () => {
      const pool = createMockPool([
        { rows: [makeProjectRow({ status: 'paused' })] },
        { rows: [makeProjectRow({ status: 'active' })] },
      ]);

      const service = new ProjectsService(pool as never);
      const result = await service.resume('org-uuid-1', 'proj-uuid-1');

      expect(result.status).toBe('active');
    });

    it('throws BadRequestException when project is already active', async () => {
      const pool = createMockPool([
        { rows: [makeProjectRow({ status: 'active' })] },
      ]);

      const service = new ProjectsService(pool as never);

      await expect(service.resume('org-uuid-1', 'proj-uuid-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne()', () => {
    it('throws NotFoundException for non-existent project', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const service = new ProjectsService(pool as never);

      await expect(service.findOne('org-1', 'bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update()', () => {
    it('throws ConflictException on version mismatch', async () => {
      const pool = createMockPool([
        { rows: [makeProjectRow({ version: 5 })] }, // findOne
      ]);

      const service = new ProjectsService(pool as never);

      await expect(
        service.update('org-uuid-1', 'proj-uuid-1', { name: 'New', version: 1 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove()', () => {
    it('soft-deletes and transitions to deleting status', async () => {
      const pool = createMockPool([
        { rows: [makeProjectRow()] }, // findOne
        { rows: [] },                  // UPDATE
      ]);

      const service = new ProjectsService(pool as never);

      await expect(service.remove('org-uuid-1', 'proj-uuid-1')).resolves.toBeUndefined();
    });
  });
});
