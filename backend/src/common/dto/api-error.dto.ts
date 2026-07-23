import { ApiProperty } from '@nestjs/swagger';

/**
 * Standard error response used in @ApiResponse declarations.
 *
 * Mirrors the default Nest exception filter payload so the schema
 * is identical to what the API actually returns.
 */
export class ApiErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    example: '2026-07-23T12:00:00.000Z',
    required: false,
    nullable: true,
  })
  timestamp?: string;

  @ApiProperty({ example: '/api/v1/users', required: false, nullable: true })
  path?: string;
}
