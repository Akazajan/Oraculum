import { Injectable, NestMiddleware, PayloadTooLargeException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class BodySizeLimitMiddleware implements NestMiddleware {
  private readonly maxSize = 1048576; // 1MB

  use(req: Request, res: Response, next: NextFunction) {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > this.maxSize) {
      throw new PayloadTooLargeException('Request body exceeds 1MB limit');
    }

    if (typeof req.body === 'string') {
      req.body = this.sanitizeString(req.body);
    }

    next();
  }

  private sanitizeString(input: string): string {
    return input.replace(/[<script>]/gi, '').trim();
  }
}
