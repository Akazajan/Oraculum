import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export const CURRENT_API_VERSION = '1';
export const SUPPORTED_API_VERSIONS = ['1'] as const;
export const DEPRECATED_API_VERSIONS: string[] = [];
export const SUNSET_DATE = '2027-01-01';

/**
 * Middleware that adds API version metadata to every response.
 *
 * - `X-API-Version`: the resolved version serving this request.
 * - `X-API-Versions-Supported`: comma-separated list of active versions.
 * - `Sunset` and `Deprecation` headers when the version is deprecated.
 */
@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const version =
      (req.params?.version as string) ?? CURRENT_API_VERSION;

    res.setHeader('X-API-Version', version);
    res.setHeader(
      'X-API-Versions-Supported',
      SUPPORTED_API_VERSIONS.join(', '),
    );

    if (DEPRECATED_API_VERSIONS.includes(version)) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', new Date(SUNSET_DATE).toUTCString());
      res.setHeader(
        'X-API-Warn',
        `Version ${version} is deprecated. Migrate to v${CURRENT_API_VERSION} before ${SUNSET_DATE}.`,
      );
    }

    next();
  }
}
