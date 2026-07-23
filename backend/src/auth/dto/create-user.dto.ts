import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';
import { StrongPassword } from '../../common/decorators/strong-password.decorator';

/**
 * BE-01 — Auth registration DTO now uses the shared `SanitizeString`
 * transformer and the `StrongPassword` decorator, so the password rule
 * cannot drift from the user-management DTOs.
 */
export class CreateUserDto {
  @ApiProperty({ example: 'jane.doe@example.com', maxLength: 254 })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @MaxLength(254)
  @SanitizeString()
  email: string;

  @ApiProperty({ example: 'Jane', maxLength: 30 })
  @IsNotEmpty({ message: 'firstname can not be empty' })
  @IsString({ message: 'firstname must be a string' })
  @MaxLength(30)
  @SanitizeString()
  firstname: string;

  @ApiProperty({ example: 'Doe', maxLength: 30 })
  @IsNotEmpty({ message: 'lastname can not be empty' })
  @IsString({ message: 'lastname must be a string' })
  @MaxLength(30)
  @SanitizeString()
  lastname: string;

  @ApiPropertyOptional({ example: 'jane_d', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @SanitizeString()
  username?: string;

  @ApiProperty({
    example: 'Sup3r$ecret!',
    minLength: 8,
    description:
      'Must contain at least one lowercase letter, one uppercase letter, one number, and one special character (@$!%*?&-_).',
  })
  @IsNotEmpty({ message: 'password can not be empty' })
  @StrongPassword()
  password: string;
}
