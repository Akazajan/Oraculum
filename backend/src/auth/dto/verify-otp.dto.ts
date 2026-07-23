import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsNotEmpty({ message: 'email is required' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @IsString()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: '482917',
    description: '6-digit OTP delivered to email',
  })
  @IsNotEmpty({ message: 'otp is required' })
  @IsString()
  @MaxLength(6)
  otp: string;
}
