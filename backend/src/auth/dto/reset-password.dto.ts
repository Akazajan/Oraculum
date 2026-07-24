import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';
import { StrongPassword } from '../../common/decorators/strong-password.decorator';

/** BE-01 — Reset-password DTO now uses the shared strong-password rule. */
export class ResetPasswordDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MaxLength(8)
  @IsNotEmpty({ message: 'otp is required' })
  @SanitizeString()
  otp: string;

  @ApiProperty({ example: 'Sup3r$ecret!' })
  @IsNotEmpty({ message: 'newPassword is required' })
  @StrongPassword()
  newPassword: string;

  @ApiProperty({ example: 'Sup3r$ecret!' })
  @IsNotEmpty({ message: 'confirmNewPassword is required' })
  @StrongPassword()
  confirmNewPassword: string;
}
