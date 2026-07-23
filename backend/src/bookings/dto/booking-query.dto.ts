import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BookingStatus } from '../enums/booking-status.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for booking list endpoints.
 *
 * Filtering:
 * - `status`: single status value (e.g. ?status=pending)
 * - `statuses`: comma-separated list (e.g. ?statuses=pending,confirmed)
 *
 * When both are supplied, both filters are applied (intersection, i.e. the
 * `statuses` field takes precedence when it contains more than one value).
 *
 * Pagination:
 * - `page`: 1-indexed page number, default 1
 * - `limit`: page size, default 20
 */
export class BookingQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'Filter by a single booking status',
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    description:
      'Filter by multiple booking statuses (comma-separated, e.g. "pending,confirmed"). Overrides status when non-empty.',
    example: 'pending,confirmed',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join(',')
      : value,
  )
  statuses?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}

/**
 * Resolve the effective status filter from a BookingQueryDto:
 * returns either undefined (no filter), a single status (single value),
 * or an array of statuses (multi-value). Invalid values are dropped so the
 * paginated list is stable when callers supply typos.
 */
export function resolveStatusFilter(
  query: BookingQueryDto,
): BookingStatus | BookingStatus[] | undefined {
  if (query.statuses) {
    const parsed = query.statuses
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is BookingStatus =>
        Object.values(BookingStatus).includes(s as BookingStatus),
      );
    if (parsed.length === 0) return undefined;
    if (parsed.length === 1) return parsed[0];
    return Array.from(new Set(parsed));
  }
  return query.status;
}
