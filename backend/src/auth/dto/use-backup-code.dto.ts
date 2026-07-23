import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/** BE-01 — Use-backup-code DTO. */
export class UseBackupCodeDto {
  @ApiProperty({ example: 'ABCD-1234', minLength: 8, maxLength: 16 })
  @IsString()
  @Length(8, 16, { message: 'code must be 8–16 characters long' })
  @IsNotEmpty({ message: 'code is required' })
  @SanitizeString()
  backupCode: string;

  @ApiProperty({
    description: 'Temporary token returned in the login response',
    example: 'temp-token-xxx',
  })
  @IsString()
  @IsNotEmpty({ message: 'tempToken is required' })
  @MaxLength(500)
  @SanitizeString()
  tempToken: string;
}
