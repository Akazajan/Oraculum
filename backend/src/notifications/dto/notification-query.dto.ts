import { IsBoolean, IsOptional, IsPositive, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const MAX_NOTIFICATION_PAGE = 100_000;
export const MAX_NOTIFICATION_LIMIT = 100;

export class NotificationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(MAX_NOTIFICATION_PAGE)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(MAX_NOTIFICATION_LIMIT)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by read/unread status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isRead?: boolean;
}
