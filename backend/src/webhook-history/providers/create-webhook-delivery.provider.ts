import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookDeliveryStatus } from '../enums/webhook-delivery-status.enum';

export interface CreateWebhookDeliveryInput {
  webhookUrl: string;
  payload: Record<string, unknown>;
  statusCode?: number;
  response?: string;
  status?: WebhookDeliveryStatus;
}

@Injectable()
export class CreateWebhookDeliveryProvider {
  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly webhookDeliveryRepository: Repository<WebhookDelivery>,
  ) {}

  async create(input: CreateWebhookDeliveryInput): Promise<WebhookDelivery> {
    const delivery = this.webhookDeliveryRepository.create({
      webhookUrl: input.webhookUrl,
      payload: input.payload,
      statusCode: input.statusCode,
      response: input.response,
      status: input.status ?? WebhookDeliveryStatus.PENDING,
      deliveredAt:
        input.status === WebhookDeliveryStatus.SUCCESS ? new Date() : null,
    });
    return this.webhookDeliveryRepository.save(delivery);
  }

  async updateResult(
    deliveryId: string,
    result: {
      statusCode: number;
      response: string;
      status: WebhookDeliveryStatus;
    },
  ): Promise<void> {
    await this.webhookDeliveryRepository.update(deliveryId, {
      statusCode: result.statusCode,
      response: result.response,
      status: result.status,
      deliveredAt: new Date(),
    });
  }

  async incrementRetry(deliveryId: string): Promise<void> {
    await this.webhookDeliveryRepository.increment(deliveryId, 'retryCount', 1);
  }
}
