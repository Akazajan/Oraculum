import { IsOptional, IsString, IsIn, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Typed schema for the audit log `metadata` field.
 * Replaces the open `Record<string, unknown>` with validated structure.
 */
export class AuditMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  previousValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  newValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class CreateAuditLogDto {
  @IsString()
  @MaxLength(80)
  action!: string;

  @IsIn(['SUCCESS', 'FAILURE'])
  outcome!: 'SUCCESS' | 'FAILURE';

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AuditMetaDto)
  metadata?: AuditMetaDto;
}