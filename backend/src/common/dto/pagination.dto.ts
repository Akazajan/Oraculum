import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Sensible defaults for the unified pagination contract (BE-15).
 * All list endpoints must use these values so behaviour is consistent.
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Unified query DTO every list endpoint should extend.
 *
 * The @Max decorator enforces the hard cap at the validation layer,
 * so oversized requests are rejected with a 400 before reaching the
 * service / database.
 */
export class PaginationDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE, minimum: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be greater than or equal to 1' })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    minimum: 1,
    maximum: MAX_LIMIT,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be greater than or equal to 1' })
  @Max(MAX_LIMIT, {
    message: `limit must be less than or equal to ${MAX_LIMIT}`,
  })
  limit: number = DEFAULT_LIMIT;
}

/**
 * Stable pagination metadata contract returned to the client.
 * Use `buildPaginationMeta()` to instantiate so the format is
 * identical across every endpoint.
 */
export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  currentPage: number;

  @ApiProperty({ example: 20 })
  itemsPerPage: number;

  @ApiProperty({ example: 100 })
  totalItems: number;

  @ApiProperty({ example: 5 })
  totalPages: number;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;

  @ApiProperty({ example: true })
  hasNextPage: boolean;
}

/**
 * Generic paginated payload shape. Kept as a class (not interface)
 * so it can be referenced from Swagger @ApiResponse({ type }).
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({ example: 'Items retrieved successfully' })
  message: string;

  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

/**
 * Compute pagination meta. Pure function so it is trivial to unit test
 * and share across services / providers.
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMetaDto {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    currentPage: page,
    itemsPerPage: safeLimit,
    totalItems: total,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

/**
 * Convenience wrapper that returns the full paginated payload
 * (data, total, page, limit, totalPages, hasPrev, hasNext).
 */
export function paginatedResponse<T>(
  message: string,
  items: T[],
  total: number,
  page: number,
  limit: number,
) {
  return {
    message,
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / Math.max(1, limit))),
    hasPreviousPage: page > 1,
    hasNextPage: page < Math.max(1, Math.ceil(total / Math.max(1, limit))),
  };
}
