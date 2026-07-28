import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SanitizeString } from '../../common/transformers/sanitize-string.transformer';

/**
 * BE-06 — Regenerate-backup-codes payload.
 *
 * The caller must re-supply their current password. That guards
 * against a hijacked access token being used to silently rotate
 * backup codes — only the real account owner, who still knows the
 * password, can replace their recovery codes.
 */
export class RegenerateBackupCodesDto {
  @ApiProperty({ example: 'current-strong-password!' })
  @IsString()
  @IsNotEmpty({ message: 'password is required to rotate backup codes' })
  @MaxLength(80)
  @SanitizeString()
  password: string;
}
