import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ReconciliationOutcome } from '../entities/reconciliation-report.entity';

export class ReconciliationQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'INV-00001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  invoiceId?: string;

  @ApiPropertyOptional({ enum: ReconciliationOutcome })
  @IsOptional()
  @IsEnum(ReconciliationOutcome)
  outcome?: ReconciliationOutcome;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsString()
  toDate?: string;
}
