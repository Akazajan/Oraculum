import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class PaymentFailureQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @ApiPropertyOptional({ description: 'Filter by provider' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Free-text search across error codes, messages, and metadata' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
