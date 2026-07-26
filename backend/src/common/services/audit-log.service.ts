import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from '../entities/audit-log.entity';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepo: Repository<AuditLogEntity>,
  ) {}

  async logAction(actorId: string, targetId: string, action: string, details?: Record<string, any>) {
    const entry = this.auditLogRepo.create({
      actorId,
      targetId,
      action,
      details,
      createdAt: new Date(),
    });
    return this.auditLogRepo.save(entry);
  }

  async getAuditLogs(query: AuditLogQueryDto) {
    const { actorId, targetId, action, page = 1, limit = 20 } = query;
    const qb = this.auditLogRepo.createQueryBuilder('audit');

    if (actorId) {
      qb.andWhere('audit.actorId = :actorId', { actorId });
    }
    if (targetId) {
      qb.andWhere('audit.targetId = :targetId', { targetId });
    }
    if (action) {
      qb.andWhere('audit.action = :action', { action });
    }

    qb.orderBy('audit.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}