import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as compression from 'compression';

@Injectable()
export class CompressionMiddleware implements NestMiddleware {
  private compressor = compression({ threshold: 1024 });

  use(req: Request, res: Response, next: NextFunction) {
    this.compressor(req, res, next);
  }
}
