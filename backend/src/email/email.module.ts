import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EmailService } from './email.service';
import { EmailQueueProvider } from './email-queue.provider';
import { EmailQueueProcessor } from './processors/email-queue.processor';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: 'email',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        },
      },
    ),
  ],
  providers: [EmailService, EmailQueueProvider, EmailQueueProcessor],
  exports: [EmailService, EmailQueueProvider],
})
export class EmailModule {}
