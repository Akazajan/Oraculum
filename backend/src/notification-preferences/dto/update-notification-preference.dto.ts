import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationFrequency } from '../enums/notification-frequency.enum';

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({ example: 'booking_confirmed' })
  @IsString()
  eventType: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: NotificationFrequency, default: NotificationFrequency.INSTANT })
  @IsOptional()
  @IsEnum(NotificationFrequency)
  frequency?: NotificationFrequency;
}
