import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  MinLength,
  IsNotEmpty,
  IsEmail,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'jane.doe@example.com', maxLength: 254 })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Jane', maxLength: 30 })
  @IsNotEmpty({ message: 'firstname can not be empty' })
  @IsString({ message: 'firstname must be a string' })
  @MaxLength(30)
  firstname: string;

  @ApiProperty({ example: 'Doe', maxLength: 30 })
  @IsNotEmpty({ message: 'lastname can not be empty' })
  @IsString({ message: 'lastname must be a string' })
  @MaxLength(30)
  lastname: string;

  @ApiPropertyOptional({ example: 'jane_d', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  username?: string;

  @ApiProperty({
    example: 'Sup3r$ecret!',
    minLength: 6,
    description: 'Must contain at least one letter and one number',
  })
  @IsNotEmpty({ message: 'password can not be empty' })
  @MinLength(6, { message: 'password must be at least 6 character long' })
  @MaxLength(80)
  password: string;
}
