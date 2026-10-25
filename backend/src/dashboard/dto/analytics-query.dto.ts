import { IsOptional, IsDateString, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

const IANA_TIMEZONE_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(IANA_TIMEZONE_PATTERN, {
    message: 'timezone must be a valid IANA timezone name',
  })
  timezone?: string;
}
