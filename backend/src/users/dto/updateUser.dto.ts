import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../enums/userRoles.enum';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';
import { OptionalStrongPassword } from '../../common/decorators/strong-password.decorator';

/** BE-01 — Users update DTO now uses the shared strong-password rule. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @SanitizeString()
  firstname?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @SanitizeString()
  lastname?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @SanitizeString()
  username?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(50)
  @SanitizeString()
  email?: string;

  @IsOptional()
  @OptionalStrongPassword()
  password?: string;

  @IsOptional()
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  verificationToken?: string;

  @IsOptional()
  verificationTokenExpiry?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  passwordResetToken?: string;

  @IsOptional()
  passwordResetExpiresIn?: Date;

  @IsOptional()
  lastPasswordResetSentAt?: Date;

  @IsOptional()
  lastVerificationEmailSent?: Date;

  @IsOptional()
  isVerified?: boolean;

  @IsOptional()
  isActive?: boolean;
}
