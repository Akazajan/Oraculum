import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MembershipStatus } from '../enums/membership-status.enum';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Query parameters for listing members (BE-15 acceptance).
 * Inherits `page` / `limit` from the unified `PaginationDto`.
 */
export class MemberQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @ApiPropertyOptional({ example: 'jane' })
  @IsOptional()
  @IsString()
  search?: string;
}
