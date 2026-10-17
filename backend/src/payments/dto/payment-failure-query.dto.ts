import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export const MAX_DATE_RANGE_DAYS = 366;

/** toDate must not be before fromDate, and the range must stay bounded. */
@ValidatorConstraint({ name: 'dateRange', async: false })
export class DateRangeConstraint implements ValidatorConstraintInterface {
  validate(toDate: unknown, args: ValidationArguments): boolean {
    const { fromDate } = args.object as { fromDate?: string };
    if (!fromDate || typeof toDate !== 'string') return true;
    const from = new Date(fromDate).getTime();
    const to = new Date(toDate).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return true; // IsDateString reports it
    return from <= to && to - from <= MAX_DATE_RANGE_DAYS * 86_400_000;
  }

  defaultMessage(): string {
    return `toDate must not be before fromDate, and the range cannot exceed ${MAX_DATE_RANGE_DAYS} days`;
  }
}

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
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  @Validate(DateRangeConstraint)
  toDate?: string;

  @ApiPropertyOptional({
    description: 'Free-text search across error codes, messages, and metadata',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}