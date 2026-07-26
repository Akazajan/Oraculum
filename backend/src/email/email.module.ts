import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EmailService } from './email.service';
import { EmailQueueProvider } from './email-queue.provider';
import { EmailQueueProcessor } from './processors/email-queue.processor';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeadLetterJob } from '../common/entities/dead-letter-job.entity';
import { DeadLetterProvider } from '../common/providers/dead-letter.provider';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([DeadLetterJob]),
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
  providers: [EmailService, EmailQueueProvider, EmailQueueProcessor, DeadLetterProvider],
  exports: [EmailService, EmailQueueProvider],
})
export class EmailModule {}
