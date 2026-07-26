import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as axios from 'axios';
import { Webhook } from './entities/webhook.entity';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { withRetry } from '../utils/retry.util';

export interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
  webhookId: string;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
  ) {}

  generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  verifySignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    const expected = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  }

  async createWebhook(dto: CreateWebhookDto): Promise<Webhook> {
    const webhook = this.webhookRepository.create({
      ...dto,
      active: dto.active ?? true,
      retryEnabled: dto.retryEnabled ?? true,
    });
    return this.webhookRepository.save(webhook);
  }

  async findAllWebhooks(): Promise<Webhook[]> {
    return this.webhookRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findActiveWebhooksForEvent(event: string): Promise<Webhook[]> {
    return this.webhookRepository.find({
      where: { active: true },
    });
  }

  async findWebhookById(id: string): Promise<Webhook | null> {
    return this.webhookRepository.findOne({ where: { id } });
  }

  async updateWebhook(
    id: string,
    dto: UpdateWebhookDto,
  ): Promise<Webhook | null> {
    await this.webhookRepository.update(id, dto);
    return this.findWebhookById(id);
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.webhookRepository.delete(id);
  }

  async triggerWebhooks(
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const webhooks = await this.webhookRepository.find({
      where: { active: true },
    });

    const matchingWebhooks = webhooks.filter((wh) =>
      wh.events.includes(event),
    );

    if (matchingWebhooks.length === 0) {
      return;
    }

    const payload: WebhookPayload = {
      event,
      data,
      timestamp: new Date().toISOString(),
      webhookId: '',
    };

    for (const webhook of matchingWebhooks) {
      payload.webhookId = webhook.id;
      this.deliverWebhook(webhook, payload).catch((err) => {
        this.logger.error(
          `Webhook ${webhook.id} delivery failed: ${(err as Error).message}`,
        );
      });
    }
  }

  private async deliverWebhook(
    webhook: Webhook,
    payload: WebhookPayload,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = this.generateSignature(body, webhook.secret);

    const isRetryable = (error: unknown): boolean => {
      if (!error || typeof error !== 'object') return false;
      const axiosError = error as { response?: { status?: number } };
      const status = axiosError.response?.status;
      if (status === 429 || status === 500 || status === 502 || status === 503) {
        return true;
      }
      return false;
    };

    try {
      await withRetry(
        async () => {
          await axios.default.post(webhook.webhookUrl, body, {
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': signature,
              'X-Webhook-Event': payload.event,
              'X-Webhook-Timestamp': payload.timestamp,
            },
            timeout: 10000,
          });
        },
        {
          maxAttempts: webhook.retryEnabled ? 3 : 1,
          baseDelayMs: 1000,
          maxDelayMs: 10000,
          isRetryable,
          onRetry: (error, attempt, delayMs) => {
            this.logger.warn(
              `Webhook ${webhook.id} attempt ${attempt} failed, retrying in ${delayMs}ms`,
            );
          },
        },
      );

      await this.webhookRepository.update(webhook.id, {
        lastTriggeredAt: new Date(),
        failureCount: 0,
      });

      this.logger.log(
        `Webhook ${webhook.id} delivered: ${payload.event}`,
      );
    } catch (error) {
      await this.webhookRepository.update(webhook.id, {
        failureCount: webhook.failureCount + 1,
        lastTriggeredAt: new Date(),
      });

      this.logger.error(
        `Webhook ${webhook.id} permanently failed: ${(error as Error).message}`,
      );

      if (webhook.failureCount >= 5) {
        await this.webhookRepository.update(webhook.id, { active: false });
        this.logger.warn(
          `Webhook ${webhook.id} deactivated after ${webhook.failureCount} failures`,
        );
      }
    }
  }
}
