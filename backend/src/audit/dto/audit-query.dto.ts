import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * BE-03 — Query parameters for the admin audit-log endpoint.
 *
 * Inherits `page` / `limit` / `MaxLimit` from the unified
 * `PaginationDto` so behaviour is identical to other list endpoints
 * (BE-15).
 */
export class AuditQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'LOGIN_SUCCESS' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ enum: ['SUCCESS', 'FAILURE'] })
  @IsOptional()
  @IsEnum(['SUCCESS', 'FAILURE'] as const)
  outcome?: 'SUCCESS' | 'FAILURE';

  @ApiPropertyOptional({ example: 'admin@Oraculum.app' })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  actorEmail?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'USER' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @ApiPropertyOptional({
    example: '2026-07-01',
    description: 'Lower-bound ISO date for createdAt',
  })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({
    example: '2026-07-31',
    description: 'Upper-bound ISO date for createdAt',
  })
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional({
    description: 'Free-text search across action / actorEmail / metadata',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;
}
