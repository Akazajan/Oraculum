import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

export interface WebhookPayload {
  eventId: string;
  eventType: string;
  data: Record<string, any>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly httpService: HttpService) {}

  validatePayload(payload: WebhookPayload): void {
    if (!payload || !payload.eventId || !payload.eventType || !payload.data) {
      throw new BadRequestException('Malformed webhook payload: missing required fields');
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

    while (attempt < maxRetries) {
      try {
        attempt++;
        const response = await lastValueFrom(
          this.httpService.post(targetUrl, payload, { timeout: 5000 }),
        );

        if (response.status >= 200 && response.status < 300) {
          return true;
        }
      } catch (error) {
        this.logger.warn(
          `Webhook delivery failed to ${targetUrl} (Attempt ${attempt}/${maxRetries}): ${error.message}`,
        );

        if (attempt >= maxRetries) {
          throw new Error(`Webhook delivery failed after ${maxRetries} attempts`);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }

    return false;
  }
}