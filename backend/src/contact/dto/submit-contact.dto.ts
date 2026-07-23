import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

export class SubmitContactDto {
  @ApiProperty({ example: 'Jane Doe', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @SanitizeString()
  fullName: string;

  @ApiProperty({ example: 'jane.doe@example.com', maxLength: 254 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  @SanitizeString()
  email: string;

  @ApiPropertyOptional({ example: '+2348012345678', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @SanitizeString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Acme Co', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @SanitizeString()
  company?: string;

  @ApiProperty({ example: 'Pricing question for 10-seat desk', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @SanitizeString()
  subject: string;

  @ApiProperty({
    example: 'Hi, please share your monthly rate for a 10-seat hot desk.',
    minLength: 10,
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  @SanitizeString()
  message: string;
}
