import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationQueryDto } from '../dto/notification-query.dto';

@Injectable()
export class FindNotificationsProvider {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
  ) {}

  async findAll(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<{
    data: Notification[];
    total: number;
    unreadCount: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const qb = this.notificationsRepository
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .andWhere('n.deletedAt IS NULL');

    if (query.isRead !== undefined) {
      qb.andWhere('n.isRead = :isRead', { isRead: query.isRead });
    }

    qb.orderBy('n.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    const unreadCount = await this.notificationsRepository.count({
      where: { userId, isRead: false, deletedAt: null },
    });

    return { data, total, unreadCount, page, limit };
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    await this.notificationsRepository.update(
      { id: notificationId, userId, deletedAt: null },
      { isRead: true },
    );
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationsRepository.update(
      { userId, isRead: false, deletedAt: null },
      { isRead: true },
    );
  }

  async findDeleted(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<{
    data: Notification[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const qb = this.notificationsRepository
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .andWhere('n.deletedAt IS NOT NULL');

    if (query.isRead !== undefined) {
      qb.andWhere('n.isRead = :isRead', { isRead: query.isRead });
    }

    qb.orderBy('n.deletedAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async restore(notificationId: string, userId: string): Promise<void> {
    await this.notificationsRepository.update(
      { id: notificationId, userId },
      { deletedAt: null },
    );
  }
}
