import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Removes undefined fields from PATCH request bodies before DTO validation and controller handling.
 *
 * Nest's built-in ClassSerializerInterceptor serializes controller responses; it does not transform
 * incoming request bodies, so it cannot provide the request-side PATCH semantics required here.
 */
@Injectable()
export class PatchUpdateInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request.method === 'PATCH') {
      request.body = Object.fromEntries(
        Object.entries(request.body || {}).filter(([, v]) => v !== undefined),
      );
    }
    return next.handle();
  }
}
