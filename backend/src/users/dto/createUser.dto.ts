import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../enums/userRoles.enum';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';
import { StrongPassword } from '../../common/decorators/strong-password.decorator';

/** BE-01 — Users create DTO now uses the shared strong-password rule. */
export class CreateUserDto {
  @ApiProperty({ minLength: 1, maxLength: 30 })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @SanitizeString()
  firstname: string;

  @ApiProperty({ minLength: 1, maxLength: 30 })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @SanitizeString()
  lastname: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @SanitizeString()
  username?: string;

  @ApiProperty({ maxLength: 50, example: 'jane.doe@example.com' })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(50)
  @SanitizeString()
  email: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 80,
    description: 'Must include lower, upper, number, and special (@$!%*?&-_).',
  })
  @IsNotEmpty()
  @StrongPassword()
  password: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.USER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
