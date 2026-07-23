import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Setup-2fa DTO. */
export class Setup2faDto {
  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6, { message: 'token must be 6 digits long' })
  @IsNotEmpty({ message: 'token is required' })
  @SanitizeString()
  token: string;
}
