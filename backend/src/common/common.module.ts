import { Global, Module } from '@nestjs/common';
import { GracefulShutdownService } from './services/graceful-shutdown.service';

@Global()
@Module({
  providers: [GracefulShutdownService],
  exports: [GracefulShutdownService],
})
export class CommonModule {}
