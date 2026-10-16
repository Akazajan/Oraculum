import { Injectable, UnauthorizedException } from '@nestjs/common';
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

  private assertUserId(userId: string): void {
    if (!userId || userId.trim() === '') {
      throw new UnauthorizedException(
        'An authenticated user is required to read notification preferences',
      );
    }
  }

  async findAll(userId: string): Promise<NotificationPreference[]> {
    this.assertUserId(userId);
    const prefs = await this.preferenceRepository.find({
      where: { userId },
      order: { channel: 'ASC', eventType: 'ASC' },
    });
    return prefs.filter((p) => p.userId === userId);
  }

  async findByUserAndChannel(
    userId: string,
    channel: NotificationChannel,
  ): Promise<NotificationPreference[]> {
    this.assertUserId(userId);
    const prefs = await this.preferenceRepository.find({
      where: { userId, channel },
      order: { eventType: 'ASC' },
    });
    return prefs.filter((p) => p.userId === userId);
  }

  async isEnabled(
    userId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<boolean> {
    this.assertUserId(userId);
    const specific = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType },
    });
    if (specific && specific.userId === userId) return specific.enabled;

    const wildcard = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType: '*' },
    });
    if (wildcard && wildcard.userId === userId) return wildcard.enabled;

    return true;
  }

  async getFrequency(
    userId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<string> {
    this.assertUserId(userId);
    const specific = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType },
    });
    if (specific && specific.userId === userId) return specific.frequency;

    const wildcard = await this.preferenceRepository.findOne({
      where: { userId, channel, eventType: '*' },
    });
    if (wildcard && wildcard.userId === userId) return wildcard.frequency;

    return 'instant';
  }
}
