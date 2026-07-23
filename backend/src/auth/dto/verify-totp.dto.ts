import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Verify-TOTP DTO. */
export class VerifyTotpDto {
  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6, { message: 'token must be 6 digits long' })
  @IsNotEmpty({ message: 'token is required' })
  @SanitizeString()
  token: string;

  @ApiProperty({
    description: 'Temporary token returned in the login response',
    example: 'temp-token-xxx',
  })
  @IsString()
  @IsNotEmpty({ message: 'tempToken is required' })
  @MaxLength(500)
  @SanitizeString()
  tempToken: string;
}
