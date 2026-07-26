import { Module } from '@nestjs/common';
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
import { DeadLetterJob } from '../common/entities/dead-letter-job.entity';
import { DeadLetterProvider } from '../common/providers/dead-letter.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, DeadLetterJob]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      {
        name: 'notification',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        },
      },
    ),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    CreateNotificationProvider,
    FindNotificationsProvider,
    NotificationQueueProcessor,
    DeadLetterProvider,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
