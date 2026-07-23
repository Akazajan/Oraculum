import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

export class SubscribeNewsletterDto {
  @ApiProperty({ example: 'subscriber@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  @SanitizeString()
  email: string;
}

export class UnsubscribeNewsletterDto {
  @ApiProperty({ description: 'Token delivered to the subscriber by email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @SanitizeString()
  token: string;
}

export class ConfirmNewsletterDto {
  @ApiProperty({
    description: 'Confirmation token delivered to the subscriber',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @SanitizeString()
  token: string;
}
