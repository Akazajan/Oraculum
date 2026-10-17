import {
  IsUUID,
  IsEnum,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanType } from '../enums/plan-type.enum';
import { RecurrenceFrequency } from '../enums/recurrence-frequency.enum';

export class CreateRecurringBookingDto {
  @ApiProperty()
  @IsUUID()
  workspaceId: string;

  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  planType: PlanType;

  @ApiProperty({
    example: '2026-04-01',
    description: 'Start of the first occurrence',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    example: '2026-04-02',
    description: 'End of the first occurrence',
  })
  @IsDateString()
  endDate: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  seatCount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    enum: RecurrenceFrequency,
    description: 'Step applied to each successive occurrence',
  })
  @IsEnum(RecurrenceFrequency)
  recurrenceFrequency: RecurrenceFrequency;

  @ApiProperty({ example: 4, description: 'Total occurrences to create' })
  @IsInt()
  @Min(1)
  @Max(52)
  occurrenceCount: number;
}
