import { Injectable } from '@nestjs/common';
import {
  CreateNotificationPreferencesProvider,
} from './providers/create-notification-preferences.provider';
import { FindNotificationPreferencesProvider } from './providers/find-notification-preferences.provider';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { NotificationChannel } from './enums/notification-channel.enum';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly createProvider: CreateNotificationPreferencesProvider,
    private readonly findProvider: FindNotificationPreferencesProvider,
  ) {}

  createDefaultPreferences(userId: string) {
    return this.createProvider.createDefaultPreferences(userId);
  }

  findAll(userId: string) {
    return this.findProvider.findAll(userId);
  }

  findByChannel(userId: string, channel: NotificationChannel) {
    return this.findProvider.findByUserAndChannel(userId, channel);
  }

  upsert(userId: string, dto: UpdateNotificationPreferenceDto) {
    return this.createProvider.upsertPreference(userId, {
      channel: dto.channel,
      eventType: dto.eventType,
      enabled: dto.enabled,
      frequency: dto.frequency,
    });
  }

  isEnabled(userId: string, channel: NotificationChannel, eventType: string) {
    return this.findProvider.isEnabled(userId, channel, eventType);
  }

  getFrequency(userId: string, channel: NotificationChannel, eventType: string) {
    return this.findProvider.getFrequency(userId, channel, eventType);
  }
}
