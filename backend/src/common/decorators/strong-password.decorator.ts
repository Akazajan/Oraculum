import { applyDecorators } from '@nestjs/common';
import {
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * BE-01 — Centralised strong-password validator.
 *
 * Replaces the duplicated `@Matches(...)` regex previously copy-pasted
 * across `users/createUser.dto.ts`, `users/updateUser.dto.ts` and
 * `auth/dto/create-user.dto.ts` so the rules — and the user-facing
 * error message — live in exactly one place.
 *
 * Rules (must contain at least one of each):
 *  - lower-case letter
 *  - upper-case letter
 *  - digit
 *  - one of: @$!%*?&-_ .
 *
 * Length is bounded 8..80 to match the prior DTOs exactly so existing
 * clients cannot regress.
 */
const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&\-_.])[A-Za-z\d@$!%*?&\-_.]+$/;

export const STRONG_PASSWORD_MESSAGE =
  'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character (@$!%*?&-_).';

export function StrongPassword() {
  return applyDecorators(
    MinLength(8, { message: 'password must be at least 8 characters long' }),
    MaxLength(80, {
      message: 'password must be at most 80 characters long',
    }),
    Matches(STRONG_PASSWORD_REGEX, { message: STRONG_PASSWORD_MESSAGE }),
  );
}

export function OptionalStrongPassword() {
  return applyDecorators(IsOptional(), StrongPassword());
}
