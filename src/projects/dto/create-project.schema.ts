import { z } from 'zod';

const AWS_REGIONS = [
  'us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1',
  'ap-southeast-1', 'ap-northeast-1', 'sa-east-1',
] as const;

// const type parameter (TS 5.0) — preserves the literal tuple type
// so `z.enum(AWS_REGIONS)` gets exact string literal types, not just `string`
export const createProjectSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim(),

  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      'Slug must be lowercase alphanumeric with hyphens',
    )
    .optional(),

  region: z.enum(AWS_REGIONS).default('us-east-1'),

  metadata: z.record(z.unknown()).default({}),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive().optional(),
});

export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
