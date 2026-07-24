import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Resend-OTP DTO. */
export class ResendOtpDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @MaxLength(254)
  @IsNotEmpty({ message: 'email is required' })
  @SanitizeString()
  email: string;
}
