import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookHistoryService } from './webhook-history.service';
import { WebhookHistoryController } from './webhook-history.controller';
import { CreateWebhookDeliveryProvider } from './providers/create-webhook-delivery.provider';
import { FindWebhookDeliveriesProvider } from './providers/find-webhook-deliveries.provider';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookDelivery])],
  controllers: [WebhookHistoryController],
  providers: [
    WebhookHistoryService,
    CreateWebhookDeliveryProvider,
    FindWebhookDeliveriesProvider,
  ],
  exports: [WebhookHistoryService],
})
export class WebhookHistoryModule {}
