import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationType } from '../enums/notification-type.enum';
import { NotificationsGateway } from '../gateway/notifications.gateway';
import { NotificationPreferencesService } from '../../notification-preferences/notification-preferences.service';
import { NotificationChannel } from '../../notification-preferences/enums/notification-channel.enum';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class CreateNotificationProvider {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    private readonly gateway: NotificationsGateway,
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const inAppEnabled = await this.preferencesService.isEnabled(
      input.userId,
      NotificationChannel.IN_APP,
      input.type,
    );

    if (!inAppEnabled) {
      return null;
    }

    const notification = this.notificationsRepository.create(input);
    const saved = await this.notificationsRepository.save(notification);

    // Push real-time event to user's socket room
    this.gateway.sendToUser(input.userId, 'notification', {
      id: saved.id,
      type: saved.type,
      title: saved.title,
      message: saved.message,
      createdAt: saved.createdAt,
    });

    return saved;
  }
}
