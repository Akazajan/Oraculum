import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Disable-2fa DTO. */
export class Disable2faDto {
  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6, { message: 'token must be 6 digits long' })
  @IsNotEmpty({ message: 'token is required' })
  @SanitizeString()
  token: string;

  @ApiProperty({ example: 'current-strong-password!' })
  @IsString()
  @IsNotEmpty({ message: 'password is required' })
  @MaxLength(80)
  @SanitizeString()
  password: string;
}
