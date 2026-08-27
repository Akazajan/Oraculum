import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './gateway/notifications.gateway';
import { CreateNotificationProvider } from './providers/create-notification.provider';
import { FindNotificationsProvider } from './providers/find-notifications.provider';
import { NotificationQueueProcessor } from './processors/notification-queue.processor';
import { NotificationPreferencesModule } from '../notification-preferences/notification-preferences.module';
import { DeadLetterModule } from '../common/dead-letter/dead-letter.module';
import { WebhookService } from './services/webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    NotificationPreferencesModule,
    HttpModule,
    DeadLetterModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'notification',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      },
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    CreateNotificationProvider,
    FindNotificationsProvider,
    NotificationQueueProcessor,
    WebhookService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
