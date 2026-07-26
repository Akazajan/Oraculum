import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
}

export interface TemplateEmailJobData {
  to: string;
  subject: string;
  templateName: string;
  placeholders: Record<string, unknown>;
}

@Injectable()
export class EmailQueueProvider {
  private readonly logger = new Logger(EmailQueueProvider.name);

  constructor(@InjectQueue('email') private readonly emailQueue: Queue) {}

  async enqueueSendEmail(data: EmailJobData): Promise<string> {
    const job = await this.emailQueue.add('send-email', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });
    this.logger.log(`Email enqueued: job ${job.id} to ${data.to}`);
    return String(job.id);
  }

  async enqueueSendTemplateEmail(data: TemplateEmailJobData): Promise<string> {
    const job = await this.emailQueue.add('send-template-email', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });
    this.logger.log(`Template email enqueued: job ${job.id} to ${data.to}`);
    return String(job.id);
  }

  async getJobStatus(jobId: string): Promise<{ status: string; data?: unknown } | null> {
    const job = await this.emailQueue.getJob(jobId);
    if (!job) return null;
    return { status: await job.getState(), data: job.returnvalue };
  }
}
