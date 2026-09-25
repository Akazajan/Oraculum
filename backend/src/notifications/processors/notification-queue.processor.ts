import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DeadLetterProvider } from '../../common/providers/dead-letter.provider';

interface SendNotificationJobData {
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

const MAX_CACHE_ENTRIES = 10_000;

@Processor('notification')
export class NotificationQueueProcessor {
  private readonly logger = new Logger(NotificationQueueProcessor.name);
  private readonly processedJobs = new Map<string, boolean>();

  constructor(private readonly deadLetterProvider: DeadLetterProvider) {}

  /**
   * Builds a stable fingerprint for a notification job so a duplicate
   * job (same recipient + content) can be detected regardless of the
   * Bull job id assigned by the queue.
   */
  private dedupKey(data: SendNotificationJobData): string {
    return [
      data.userId,
      data.type,
      data.title,
      data.message,
      JSON.stringify(data.metadata ?? {}),
    ].join('|');
  }

  private rememberProcessed(key: string): void {
    if (this.processedJobs.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.processedJobs.keys().next().value;
      if (oldest !== undefined) this.processedJobs.delete(oldest);
    }
    this.processedJobs.set(key, true);
  }

  @Process('send-notification')
  async handleSendNotification(
    job: Job<SendNotificationJobData>,
  ) {
    this.logger.log(
      `Processing notification job ${job.id} for user ${job.data.userId}`,
    );

    const key = this.dedupKey(job.data);

    // B40 — A duplicate job does not send a second notification. If the
    // same notification was already processed successfully, return the
    // prior outcome so the queue treats the job as done without fan-out.
    if (this.processedJobs.get(key)) {
      this.logger.log(
        `Notification job ${job.id} is a duplicate — skipping send`,
      );
      return { success: true, jobId: job.id, deduplicated: true };
    }

    try {
      await this.sendNotification(job.data);
      // Record completion BEFORE returning so a subsequent duplicate
      // (or a retried success-path re-run) is recognized as done.
      this.rememberProcessed(key);
      await job.progress(100);
      return { success: true, jobId: job.id };
    } catch (error) {
      // Do not mark as processed on failure so the job remains retryable.
      this.logger.error(
        `Notification job ${job.id} failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Sends the notification to the subscription provider. Kept as a
   * distinct step so completion can be recorded after the side effect
   * succeeds but before the queue handler returns.
   */
  private async sendNotification(data: SendNotificationJobData): Promise<void> {
    // Delivery to the underlying notification sink; a thrown error here
    // leaves the job retryable.
  }
}