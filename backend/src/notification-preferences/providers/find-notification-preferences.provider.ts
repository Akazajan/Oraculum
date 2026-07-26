import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';

@Injectable()
export class FindNotificationPreferencesProvider {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  async findAll(userId: string): Promise<NotificationPreference[]> {
    return this.preferenceRepository.find({
      where: { userId },
      order: { channel: 'ASC', eventType: 'ASC' },
    });
  }

  async findByUserAndChannel(
    userId: string,
    channel: NotificationChannel,
  ): Promise<NotificationPreference[]> {
    return this.preferenceRepository.find({
      where: { userId, channel },
      order: { eventType: 'ASC' },
    });
  }

  async isEnabled(
    userId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<boolean> {
    const specific = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType },
    });
    if (specific) return specific.enabled;

    const wildcard = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType: '*' },
    });
    if (wildcard) return wildcard.enabled;

    return true;
  }

  async getFrequency(
    userId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<string> {
    const specific = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType },
    });
    if (specific) return specific.frequency;

    const wildcard = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType: '*' },
    });
    if (wildcard) return wildcard.frequency;

    return 'instant';
  }
}
