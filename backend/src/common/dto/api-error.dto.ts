import { ApiProperty } from '@nestjs/swagger';

/**
 * BE-01 — Standard error response used in @ApiResponse declarations.
 *
 * Compatible with the Nest default exception filter payload, plus the
 * extra fields surfaced by the centralized validation pipe and global
 * exception filter:
 *  - `correlationId` lets support staff tie a user-visible error back
 *    to the request log line.
 *  - `fields` is only present for 400 validation errors so Swagger UI
 *    can render the structured validator output.
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

  @ApiProperty({
    example: '5e3b1c9a-1234-4abc-9876-abcdef012345',
    required: false,
    nullable: true,
    description:
      'Request correlation ID (BE-08). Echoed in the x-correlation-id response header.',
  })
  correlationId?: string;
}
