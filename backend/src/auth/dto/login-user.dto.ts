import { ApiProperty } from '@nestjs/swagger';
import { MinLength, IsNotEmpty, IsEmail, MaxLength } from 'class-validator';

export class LoginUserDto {
  @ApiProperty({
    example: 'jane.doe@example.com',
    description: 'Registered user email',
  })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'Sup3r$ecret!',
    minLength: 8,
    description: 'Plain-text password (sent to the API over HTTPS only)',
  })
  @IsNotEmpty({ message: 'password can not be empty' })
  @MinLength(8, { message: 'password must be at least 8 character long' })
  @MaxLength(80)
  password: string;
}
