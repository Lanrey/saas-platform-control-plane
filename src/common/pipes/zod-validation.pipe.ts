import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';
import { ErrorCode } from '../filters/http-exception.filter';

/**
 * Zod-backed validation pipe.
 *
 * NestJS ships with class-validator + class-transformer as the default
 * validation mechanism. We use Zod instead because:
 *
 * 1. Single source of truth: Zod schemas define both validation AND TypeScript
 *    types via `z.infer<>`. class-validator requires decorating a DTO class
 *    AND writing a separate type — duplication that drifts.
 *
 * 2. Composability: Zod schemas can be `.merge()`-d, `.pick()`-d, `.omit()`-d
 *    and combined with `.and()` / `.or()` purely at the type level, which
 *    produces correct inference automatically.
 *
 * 3. No reflection overhead: class-transformer uses `reflect-metadata` to
 *    reify types at runtime — Zod operates on plain JS objects.
 *
 * 4. Explicit error messages: Zod produces structured `ZodError` with issue
 *    paths and codes, which we map to our RFC 9457 field errors.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      throw new BadRequestException({
        message: 'Request validation failed',
        code: ErrorCode.VALIDATION_ERROR,
        errors,
      });
    }

    return result.data;
  }
}

/**
 * Format ZodError issues into our field-error shape.
 * Zod paths like `['items', 0, 'name']` are joined to `'items[0].name'`.
 */
function formatZodErrors(
  error: ZodError,
): Array<{ field: string; message: string; code: string }> {
  return error.issues.map((issue) => ({
    field: issue.path
      .map((segment, i) =>
        typeof segment === 'number'
          ? `[${segment}]`
          : i === 0
            ? String(segment)
            : `.${segment}`,
      )
      .join(''),
    message: issue.message,
    code: issue.code,
  }));
}
