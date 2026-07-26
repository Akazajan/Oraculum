import { IsEnum, IsOptional, IsPositive, IsString, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookDeliveryStatus } from '../enums/webhook-delivery-status.enum';

export class WebhookDeliveryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: WebhookDeliveryStatus })
  @IsOptional()
  @IsEnum(WebhookDeliveryStatus)
  status?: WebhookDeliveryStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
