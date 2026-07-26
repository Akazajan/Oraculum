import { Injectable } from '@nestjs/common';
import {
  CreateWebhookDeliveryProvider,
  CreateWebhookDeliveryInput,
} from './providers/create-webhook-delivery.provider';
import { FindWebhookDeliveriesProvider } from './providers/find-webhook-deliveries.provider';
import { WebhookDeliveryQueryDto } from './dto/webhook-delivery-query.dto';
import { WebhookDeliveryStatus } from './enums/webhook-delivery-status.enum';

@Injectable()
export class WebhookHistoryService {
  constructor(
    private readonly createWebhookDeliveryProvider: CreateWebhookDeliveryProvider,
    private readonly findWebhookDeliveriesProvider: FindWebhookDeliveriesProvider,
  ) {}

  create(input: CreateWebhookDeliveryInput) {
    return this.createWebhookDeliveryProvider.create(input);
  }

  findAll(query: WebhookDeliveryQueryDto) {
    return this.findWebhookDeliveriesProvider.findAll(query);
  }

  findById(deliveryId: string) {
    return this.findWebhookDeliveriesProvider.findById(deliveryId);
  }

  updateResult(
    deliveryId: string,
    result: {
      statusCode: number;
      response: string;
      status: WebhookDeliveryStatus;
    },
  ) {
    return this.createWebhookDeliveryProvider.updateResult(deliveryId, result);
  }

  incrementRetry(deliveryId: string) {
    return this.createWebhookDeliveryProvider.incrementRetry(deliveryId);
  }
}
