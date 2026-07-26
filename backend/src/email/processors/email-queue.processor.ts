import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DeadLetterProvider } from '../../common/providers/dead-letter.provider';

@Processor('email')
export class EmailQueueProcessor {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(
    private readonly deadLetterProvider: DeadLetterProvider,
  ) {}

  @Process('send-email')
  async handleSendEmail(job: Job<{ to: string; subject: string; html: string }>) {
    this.logger.log(`Processing email job ${job.id}: ${job.data.subject}`);
    try {
      // Job is handled by the email-queue.provider when queue mode is used.
      // This processor is a placeholder for the queue consumer.
      await job.progress(100);
      return { success: true, jobId: job.id };
    } catch (error) {
      this.logger.error(`Email job ${job.id} failed: ${(error as Error).message}`);
      throw error;
    }
  }

  @Process('send-template-email')
  async handleSendTemplateEmail(
    job: Job<{
      to: string;
      subject: string;
      templateName: string;
      placeholders: Record<string, unknown>;
    }>,
  ) {
    this.logger.log(
      `Processing template email job ${job.id}: ${job.data.templateName}`,
    );
    try {
      await job.progress(100);
      return { success: true, jobId: job.id };
    } catch (error) {
      this.logger.error(
        `Template email job ${job.id} failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
