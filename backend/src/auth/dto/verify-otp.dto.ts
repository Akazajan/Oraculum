import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Verify-OTP DTO. */
export class VerifyOtpDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @MaxLength(254)
  @IsNotEmpty({ message: 'email is required' })
  @SanitizeString()
  email: string;

  @ApiProperty({ example: '123456', minLength: 4, maxLength: 8 })
  @IsString()
  @Length(4, 8, { message: 'otp must be 4–8 characters long' })
  @IsNotEmpty({ message: 'otp is required' })
  @SanitizeString()
  otp: string;
}
