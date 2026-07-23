import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Send-password-reset-otp DTO. */
export class SendPasswordResetOtpDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @MaxLength(254)
  @IsNotEmpty({ message: 'email is required' })
  @SanitizeString()
  email: string;
}
