import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { WorkspaceType } from '../enums/workspace-type.enum';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Query parameters for listing workspaces (BE-15 acceptance).
 * Inherits `page` / `limit` from the unified `PaginationDto`.
 */
export class WorkspaceQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: WorkspaceType })
  @IsOptional()
  @IsEnum(WorkspaceType)
  type?: WorkspaceType;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minSeats?: number;

  @ApiPropertyOptional({
    example: 500000,
    description: 'Maximum hourly rate (kobo)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRate?: number;

  @ApiPropertyOptional({ example: 'lagos' })
  @IsOptional()
  @IsString()
  search?: string;
}
