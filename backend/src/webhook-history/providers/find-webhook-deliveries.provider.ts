import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookDeliveryQueryDto } from '../dto/webhook-delivery-query.dto';

@Injectable()
export class FindWebhookDeliveriesProvider {
  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly webhookDeliveryRepository: Repository<WebhookDelivery>,
  ) {}

  async findAll(
    query: WebhookDeliveryQueryDto,
  ): Promise<{
    data: WebhookDelivery[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const qb = this.webhookDeliveryRepository.createQueryBuilder('wd');

    if (query.status) {
      qb.andWhere('wd.status = :status', { status: query.status });
    }

    if (query.webhookUrl) {
      qb.andWhere('wd.webhookUrl ILIKE :webhookUrl', {
        webhookUrl: `%${query.webhookUrl}%`,
      });
    }

    if (query.startDate) {
      qb.andWhere('wd.createdAt >= :startDate', {
        startDate: query.startDate,
      });
    }

    if (query.endDate) {
      qb.andWhere('wd.createdAt <= :endDate', {
        endDate: `${query.endDate} 23:59:59`,
      });
    }

    qb.orderBy('wd.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async findById(deliveryId: string): Promise<WebhookDelivery | null> {
    return this.webhookDeliveryRepository.findOne({
      where: { id: deliveryId },
    });
  }
}
