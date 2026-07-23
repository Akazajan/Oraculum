import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: '482917',
    description: 'OTP delivered via reset email',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(6)
  otp: string;

  @ApiProperty({ example: 'N3wSup3r$ecret!', minLength: 8 })
  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  @MaxLength(80)
  @IsString()
  newPassword: string;

  @ApiProperty({ example: 'N3wSup3r$ecret!' })
  @IsNotEmpty()
  @IsString()
  confirmNewPassword: string;
}
