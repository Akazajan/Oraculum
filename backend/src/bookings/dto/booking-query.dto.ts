import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { BookingStatus } from '../enums/booking-status.enum';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Query parameters for listing bookings (BE-15 acceptance).
 * Inherits `page` / `limit` from the unified `PaginationDto` so
 * defaults, validation, and the 100-item hard cap are identical
 * to other list endpoints.
 */
export class BookingQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ description: 'Filter by workspace UUID' })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @ApiPropertyOptional({ description: 'Filter by user UUID (admin only)' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    example: '2026-04-01',
    description: 'ISO date (Y/M/D)',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-04-30',
    description: 'ISO date (Y/M/D)',
  })
  @IsOptional()
  @IsString()
  endDate?: string;
}
