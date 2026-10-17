import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';

export function ErrorCatch(error: any, message: string): never {
  if (error instanceof HttpException) {
    throw error;
  }

  // CT-07: admin-transfer expiry boundary must have one explicit outcome.
  // Acceptance at the exact expiry timestamp is rejected; expired proposals
  // cannot change admin state. Surface this as a deterministic 400 rather
  // than a generic 500 so callers can distinguish the boundary case.
  if (
    error instanceof Error &&
    (error.name === 'AdminTransferExpiredError' ||
      error.message === 'admin transfer expired')
  ) {
    throw new BadRequestException(`${message}: admin transfer expired`);
  }

  throw new InternalServerErrorException(`${message}: Internal server error`);
}
