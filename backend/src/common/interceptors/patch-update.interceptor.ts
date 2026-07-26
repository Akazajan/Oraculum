import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class PatchUpdateInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request.method === 'PATCH') {
      request.body = Object.fromEntries(
        Object.entries(request.body || {}).filter(([, v]) => v !== undefined)
      );
    }
    return next.handle();
  }
}
