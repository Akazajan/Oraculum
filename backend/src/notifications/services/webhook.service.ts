import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { DeadLetterProvider } from '../../common/providers/dead-letter.provider';

export interface WebhookPayload {
  eventId: string;
  eventType: string;
  data: Record<string, any>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly deadLetterProvider: DeadLetterProvider,
  ) {}

  validatePayload(payload: WebhookPayload): void {
    if (!payload || !payload.eventId || !payload.eventType || !payload.data) {
      throw new BadRequestException(
        'Malformed webhook payload: missing required fields',
      );
    }
  }

  async dispatchWithRetry(
    targetUrl: string,
    payload: WebhookPayload,
    maxRetries: number = 3,
    initialDelayMs: number = 100,
  ): Promise<boolean> {
    this.validatePayload(payload);

    let attempt = 0;
    let delay = initialDelayMs;
    let lastError = 'Non-success response from subscriber';

    while (attempt < maxRetries) {
      try {
        attempt++;
        const response = await lastValueFrom(
          this.httpService.post(targetUrl, payload, { timeout: 5000 }),
        );

        if (response.status >= 200 && response.status < 300) {
          return true;
        }

        if (response.status < 500) {
          return false;
        }

        lastError = `Subscriber responded with HTTP ${response.status}`;
        throw new Error(lastError);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Webhook delivery failed to ${targetUrl} (Attempt ${attempt}/${maxRetries}): ${lastError}`,
        );

        if (attempt >= maxRetries) {
          await this.deadLetterProvider.storeFailedJob({
            queueName: 'notification',
            jobId: payload.eventId,
            jobName: 'deliver-webhook',
            data: { targetUrl, payload },
            errorMessage: lastError,
            totalAttempts: attempt,
            attemptsResult: { targetUrl, lastAttempt: attempt },
          });
          throw new Error(
            `Webhook delivery failed after ${maxRetries} attempts`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }

    return false;
  }
}
