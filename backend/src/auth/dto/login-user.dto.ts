import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Login DTO now sanitises free-text inputs. */
export class LoginUserDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email' })
  @MaxLength(254)
  @IsNotEmpty({ message: 'email is required' })
  @SanitizeString()
  email: string;

  @ApiProperty({ example: 'Sup3r$ecret!' })
  @IsString()
  @MaxLength(80)
  @IsNotEmpty({ message: 'password is required' })
  @SanitizeString()
  password: string;
}
