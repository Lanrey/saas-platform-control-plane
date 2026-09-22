import { z } from 'zod';

/** All fields are optional on update — PATCH semantics */
export const updateOrgSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim()
    .optional(),

  plan: z.enum(['free', 'pro', 'enterprise']).optional(),

  metadata: z.record(z.unknown()).optional(),

  /**
   * Optimistic concurrency version — required when updating to prevent
   * lost updates in concurrent edit scenarios.
   * The server increments version on each successful update.
   */
  version: z
    .number()
    .int()
    .positive('Version must be a positive integer')
    .optional(),
});

export type UpdateOrgDto = z.infer<typeof updateOrgSchema>;
