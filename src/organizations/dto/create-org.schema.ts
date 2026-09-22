import { z } from 'zod';

/**
 * Zod schema for creating an organization.
 *
 * Slug generation: if not provided, derived from name by lowercasing,
 * replacing non-alphanumeric characters with hyphens, and deduplicating.
 * Example: "My Company Inc." → "my-company-inc"
 */
export const createOrgSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim(),

  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(63, 'Slug must be at most 63 characters')
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      'Slug must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric',
    )
    .optional(),

  plan: z
    .enum(['free', 'pro', 'enterprise'])
    .default('free'),

  metadata: z
    .record(z.unknown())
    .default({}),
});

export type CreateOrgDto = z.infer<typeof createOrgSchema>;

/** Derive a URL-safe slug from a display name */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 63);
}
