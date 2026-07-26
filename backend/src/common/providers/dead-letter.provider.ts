import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeadLetterJob } from '../entities/dead-letter-job.entity';

@Injectable()
export class DeadLetterProvider {
  private readonly logger = new Logger(DeadLetterProvider.name);

  constructor(
    @InjectRepository(DeadLetterJob)
    private readonly deadLetterRepository: Repository<DeadLetterJob>,
  ) {}

  async storeFailedJob(payload: {
    queueName: string;
    jobId: string;
    jobName: string;
    data: Record<string, unknown>;
    errorMessage: string;
    totalAttempts: number;
    attemptsResult?: Record<string, unknown>;
  }): Promise<DeadLetterJob> {
    const job = this.deadLetterRepository.create({
      ...payload,
      lastAttemptAt: new Date(),
    });
    const saved = await this.deadLetterRepository.save(job);
    this.logger.warn(
      `Dead-letter job stored: ${saved.id} (queue=${payload.queueName}, job=${payload.jobName})`,
    );
    return saved;
  }

  async findAll(options?: {
    queueName?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ jobs: DeadLetterJob[]; total: number }> {
    const qb = this.deadLetterRepository.createQueryBuilder('job');

    if (options?.queueName) {
      qb.andWhere('job.queueName = :queueName', {
        queueName: options.queueName,
      });
    }
    if (options?.status) {
      qb.andWhere('job.status = :status', { status: options.status });
    }

    qb.orderBy('job.createdAt', 'DESC');

    const total = await qb.getCount();
    const jobs = await qb
      .skip(options?.offset ?? 0)
      .take(options?.limit ?? 50)
      .getMany();

    return { jobs, total };
  }

  async findById(id: string): Promise<DeadLetterJob | null> {
    return this.deadLetterRepository.findOne({ where: { id } });
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.deadLetterRepository.update(id, {
      status,
      retriedAt: new Date(),
    });
  }

  async remove(id: string): Promise<void> {
    await this.deadLetterRepository.delete(id);
  }
}
