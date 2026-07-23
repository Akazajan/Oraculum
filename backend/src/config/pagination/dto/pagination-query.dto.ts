import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  PaginationDto,
} from '../../../common/dto/pagination.dto';

/**
 * Pagination query — kept in the historical config/pagination path
 * for backwards compatibility with existing imports. It now extends
 * the unified PaginationDto so every list endpoint has identical
 * defaults, validation messages, and a hard MAX_LIMIT cap (BE-15).
 */
export class PaginationQueryDto extends PaginationDto {
  @ApiPropertyOptional({ required: false, example: 'coworking' })
  @IsOptional()
  @Type(() => String)
  category?: string;

  @ApiPropertyOptional({ required: false, example: 'lagos' })
  @IsOptional()
  @Type(() => String)
  searchTerm?: string;
}

/**
 * Defaults exported here too so older call sites that
 * previously hard-coded 10 / 20 / 100 keep working.
 */
export const PAGINATION_DEFAULTS = {
  page: DEFAULT_PAGE,
  limit: DEFAULT_LIMIT,
  maxLimit: MAX_LIMIT,
} as const;

export { IsString };
