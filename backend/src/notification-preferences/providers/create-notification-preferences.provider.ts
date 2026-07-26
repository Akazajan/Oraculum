import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationFrequency } from '../enums/notification-frequency.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';

const DEFAULT_PREFERENCES: Array<{
  channel: NotificationChannel;
  eventType: string;
  enabled: boolean;
  frequency: NotificationFrequency;
}> = [
  { channel: NotificationChannel.IN_APP, eventType: '*', enabled: true, frequency: NotificationFrequency.INSTANT },
  { channel: NotificationChannel.EMAIL, eventType: NotificationType.BOOKING_CONFIRMED, enabled: true, frequency: NotificationFrequency.INSTANT },
  { channel: NotificationChannel.EMAIL, eventType: NotificationType.BOOKING_CANCELLED, enabled: true, frequency: NotificationFrequency.INSTANT },
  { channel: NotificationChannel.EMAIL, eventType: NotificationType.PAYMENT_SUCCESS, enabled: true, frequency: NotificationFrequency.INSTANT },
  { channel: NotificationChannel.EMAIL, eventType: NotificationType.PAYMENT_FAILED, enabled: true, frequency: NotificationFrequency.INSTANT },
  { channel: NotificationChannel.EMAIL, eventType: NotificationType.INVOICE_GENERATED, enabled: true, frequency: NotificationFrequency.INSTANT },
];

@Injectable()
export class CreateNotificationPreferencesProvider {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  async createDefaultPreferences(userId: string): Promise<NotificationPreference[]> {
    const existing = await this.preferenceRepository.find({ where: { userId } });
    if (existing.length > 0) return existing;

    const prefs = DEFAULT_PREFERENCES.map((pref) =>
      this.preferenceRepository.create({ ...pref, userId }),
    );
    return this.preferenceRepository.save(prefs);
  }

  async upsertPreference(
    userId: string,
    input: {
      channel: NotificationChannel;
      eventType: string;
      enabled?: boolean;
      frequency?: NotificationFrequency;
    },
  ): Promise<NotificationPreference> {
    let pref = await this.preferenceRepository.findOne({
      where: {
        userId,
        channel: input.channel,
        eventType: input.eventType,
      },
    });

    if (pref) {
      if (input.enabled !== undefined) pref.enabled = input.enabled;
      if (input.frequency !== undefined) pref.frequency = input.frequency;
    } else {
      pref = this.preferenceRepository.create({
        userId,
        channel: input.channel,
        eventType: input.eventType,
        enabled: input.enabled ?? true,
        frequency: input.frequency ?? NotificationFrequency.INSTANT,
      });
    }

    return this.preferenceRepository.save(pref);
  }
}
