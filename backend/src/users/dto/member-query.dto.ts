import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MembershipStatus } from '../enums/membership-status.enum';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  PaginationDto,
} from '../../common/dto/pagination.dto';

/**
 * BE-18 — Hard ceiling on the `page` query parameter.
 *
 * `PaginationDto` already bounds `limit` (see `MAX_LIMIT`) but leaves
 * `page` unbounded, so `?page=999999999` produced a multi-billion row
 * OFFSET that forced Postgres to scan and discard the whole table before
 * returning nothing. Capping the page number keeps the worst case at
 * `MAX_MEMBER_PAGE * MAX_LIMIT` rows scanned.
 */
export const MAX_MEMBER_PAGE = 10_000;

/**
 * BE-18 — Hard ceiling on the free-text `search` filter. Without a
 * bound, a caller could push an arbitrarily long string into the
 * `LIKE '%…%'` predicate for every member-list request.
 */
export const MAX_MEMBER_SEARCH_LENGTH = 100;

/**
 * Query parameters for listing members (BE-15 acceptance).
 * Inherits `page` / `limit` from the unified `PaginationDto` and adds
 * BE-18 bounds so a single request can never fan out into an
 * unbounded table scan.
 */
export class MemberQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @ApiPropertyOptional({
    example: 'jane',
    maxLength: MAX_MEMBER_SEARCH_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MEMBER_SEARCH_LENGTH, {
    message: `search must be at most ${MAX_MEMBER_SEARCH_LENGTH} characters`,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  /**
   * Re-declared (rather than inherited) so the member endpoints can
   * reject absurd page numbers while the rest of the API keeps the
   * `PaginationDto` default of "any page >= 1".
   */
  @ApiPropertyOptional({
    default: DEFAULT_PAGE,
    minimum: 1,
    maximum: MAX_MEMBER_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be greater than or equal to 1' })
  @Max(MAX_MEMBER_PAGE, {
    message: `page must be less than or equal to ${MAX_MEMBER_PAGE}`,
  })
  override page: number = DEFAULT_PAGE;
}

/**
 * BE-18 — Clamp a raw query value into the inclusive range
 * `[min, max]`. Non-numeric / `NaN` / `Infinity` input falls back to
 * `fallback` instead of leaking `NaN` into the SQL builder, and the
 * value is truncated so a fractional page can never produce a
 * fractional OFFSET.
 */
export function clampQueryNumber(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * BE-18 — Resolve the page size actually used for the query. Oversized
 * requests are capped at `MAX_LIMIT` rather than rejected so the
 * endpoint degrades predictably for callers that bypass the DTO layer
 * (internal service calls, legacy admin tooling).
 */
export function resolveMemberLimit(limit: unknown): number {
  return clampQueryNumber(limit, {
    min: 1,
    max: MAX_LIMIT,
    fallback: DEFAULT_LIMIT,
  });
}

/**
 * BE-18 — Resolve the 1-indexed page actually used for the query.
 */
export function resolveMemberPage(page: unknown): number {
  return clampQueryNumber(page, {
    min: 1,
    max: MAX_MEMBER_PAGE,
    fallback: DEFAULT_PAGE,
  });
}

/**
 * BE-18 — Normalise the free-text search filter: trim, bound the
 * length, and escape the `LIKE` wildcards (`%` and `_`) so a search
 * term can never widen into a full-table match. Returns `undefined`
 * when nothing searchable is left.
 */
export function resolveMemberSearch(search: unknown): string | undefined {
  if (typeof search !== 'string') return undefined;
  const trimmed = search.trim().slice(0, MAX_MEMBER_SEARCH_LENGTH);
  if (!trimmed) return undefined;
  return escapeLikePattern(trimmed.toLowerCase());
}

/**
 * Escape the characters PostgreSQL treats as wildcards inside `LIKE`
 * so a user-supplied term is matched literally. The default LIKE
 * escape character in PostgreSQL is a backslash, so no extra `ESCAPE`
 * clause is required.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
