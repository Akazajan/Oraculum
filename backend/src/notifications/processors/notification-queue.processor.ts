import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DeadLetterProvider } from '../../common/providers/dead-letter.provider';

@Processor('notification')
export class NotificationQueueProcessor {
  private readonly logger = new Logger(NotificationQueueProcessor.name);

  constructor(private readonly deadLetterProvider: DeadLetterProvider) {}

  @Process('send-notification')
  async handleSendNotification(
    job: Job<{ userId: string; type: string; title: string; message: string; metadata?: Record<string, unknown> }>,
  ) {
    this.logger.log(
      `Processing notification job ${job.id} for user ${job.data.userId}`,
    );
    try {
      await job.progress(100);
      return { success: true, jobId: job.id };
    } catch (error) {
      this.logger.error(
        `Notification job ${job.id} failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
