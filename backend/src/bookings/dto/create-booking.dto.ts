import {
  IsUUID,
  IsEnum,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { PlanType } from '../enums/plan-type.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** B28 – rejects bookings whose end timestamp is not strictly after start. */
@ValidatorConstraint({ name: 'isEndAfterStart', async: false })
class IsEndAfterStartConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { startDate } = args.object as { startDate?: unknown };
    return new Date(value as string).getTime() > new Date(startDate as string).getTime();
  }

  defaultMessage(): string {
    return 'endDate must be after startDate';
  }
}

export class CreateBookingDto {
  @ApiProperty()
  @IsUUID()
  workspaceId: string;

  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  planType: PlanType;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-04-30' })
  @IsDateString()
  @Validate(IsEndAfterStartConstraint)
  endDate: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  seatCount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
