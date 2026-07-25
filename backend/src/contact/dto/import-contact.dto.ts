import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportContactsDto {
  @ApiPropertyOptional({ description: 'Optional source label for the import' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;
}
