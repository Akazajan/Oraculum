import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { CreateNotificationPreferencesProvider } from './providers/create-notification-preferences.provider';
import { FindNotificationPreferencesProvider } from './providers/find-notification-preferences.provider';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationPreference])],
  controllers: [NotificationPreferencesController],
  providers: [
    NotificationPreferencesService,
    CreateNotificationPreferencesProvider,
    FindNotificationPreferencesProvider,
  ],
  exports: [NotificationPreferencesService],
})
export class NotificationPreferencesModule {}
