import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CreateBookingDto } from '../../bookings/dto/create-booking.dto';
import { CreateBookingProvider } from '../../bookings/providers/create-booking.provider';

export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export class CreateRecurringBookingDto extends CreateBookingDto {
  @ApiProperty({ enum: ['daily', 'weekly', 'monthly', 'yearly'] })
  @IsEnum(['daily', 'weekly', 'monthly', 'yearly'])
  pattern: RecurrencePattern;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  interval: number;

  @ApiPropertyOptional({ example: 12, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOccurrences?: number;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  recurrenceEndDate?: string;
}

export interface RecurringBooking {
  bookingId: string;
  pattern: RecurrencePattern;
  startDate: Date;
  endDate?: Date;
  maxOccurrences?: number;
  daysOfWeek?: number[];
  interval: number;
}

@Injectable()
export class RecurringBookingService {
  constructor(private readonly createBookingProvider: CreateBookingProvider) {}

  async create(
    dto: CreateRecurringBookingDto,
    userId: string,
  ) {
    const duration = this.dateDifferenceInDays(dto.startDate, dto.endDate);
    const occurrences = this.generateOccurrences({
      bookingId: dto.workspaceId,
      pattern: dto.pattern,
      startDate: new Date(dto.startDate),
      endDate: dto.recurrenceEndDate
        ? new Date(dto.recurrenceEndDate)
        : undefined,
      maxOccurrences: dto.maxOccurrences,
      interval: dto.interval,
    });

    return Promise.all(
      occurrences.map((startDate) => {
        const start = this.formatDate(startDate);
        const end = new Date(startDate);
        end.setUTCDate(end.getUTCDate() + duration);

        return this.createBookingProvider.create(
          { ...dto, startDate: start, endDate: this.formatDate(end) },
          userId,
        );
      }),
    );
  }

  generateOccurrences(config: RecurringBooking): Date[] {
    const occurrences: Date[] = [];
    let current = new Date(config.startDate);
    let count = 0;

    while (
      count < (config.maxOccurrences || 52) &&
      (!config.endDate || current <= config.endDate)
    ) {
      occurrences.push(new Date(current));
      
      switch (config.pattern) {
        case 'daily':
          current.setDate(current.getDate() + config.interval);
          break;
        case 'weekly':
          current.setDate(current.getDate() + config.interval * 7);
          break;
        case 'monthly':
          current.setMonth(current.getMonth() + config.interval);
          break;
        case 'yearly':
          current.setFullYear(current.getFullYear() + config.interval);
          break;
      }
      count++;
    }
    
    return occurrences;
  }

  private dateDifferenceInDays(startDate: string, endDate: string): number {
    return Math.round(
      (Date.parse(endDate) - Date.parse(startDate)) / (24 * 60 * 60 * 1000),
    );
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
