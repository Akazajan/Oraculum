import {
  IsString,
  IsUrl,
  IsArray,
  IsOptional,
  IsBoolean,
  ArrayNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsUrl()
  webhookUrl: string;

  @ApiProperty({ example: 'my-secret-key-123' })
  @IsString()
  secret: string;

  @ApiProperty({
    example: ['booking_confirmed', 'payment_success'],
    description: 'Events to subscribe to',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];

  @ApiPropertyOptional({ example: 'Production webhook' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  retryEnabled?: boolean;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsUrl()
  @IsOptional()
  webhookUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  secret?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  events?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  retryEnabled?: boolean;
}
