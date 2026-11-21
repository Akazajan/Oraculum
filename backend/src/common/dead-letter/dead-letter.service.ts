import { Injectable } from '@nestjs/common';
import { DeadLetterProvider } from '../providers/dead-letter.provider';
import { DeadLetterJob } from '../entities/dead-letter-job.entity';

export interface FailedJobPayload {
  queueName: string;
  jobId: string;
  jobName: string;
  data: Record<string, unknown>;
  errorMessage: string;
  totalAttempts: number;
  attemptsResult?: Record<string, unknown>;
}

const DEDUP_SCAN_LIMIT = 1000;

@Injectable()
export class DeadLetterService {
  constructor(private readonly deadLetterProvider: DeadLetterProvider) {}

  /**
   * Records a failed job, collapsing repeated failures of the same job
   * (same queueName + jobId, still pending) into a single entry that carries
   * the latest failure metadata.
   */
  async recordFailure(payload: FailedJobPayload): Promise<DeadLetterJob> {
    const { jobs } = await this.deadLetterProvider.findAll({
      queueName: payload.queueName,
      status: 'pending',
      limit: DEDUP_SCAN_LIMIT,
    });

    const duplicates = jobs.filter((job) => job.jobId === payload.jobId);

    for (const duplicate of duplicates) {
      await this.deadLetterProvider.remove(duplicate.id);
    }

    return this.deadLetterProvider.storeFailedJob(payload);
  }

  async findAll(options?: {
    queueName?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const result = await this.deadLetterProvider.findAll(options);
    const jobs = this.dedupeLatest(result.jobs ?? []);
    const removed = (result.jobs?.length ?? 0) - jobs.length;
    return { jobs, total: Math.max(0, result.total - removed) };
  }

  async findById(id: string) {
    return this.deadLetterProvider.findById(id);
  }

  async markRetried(id: string) {
    return this.deadLetterProvider.updateStatus(id, 'retried');
  }

  async markResolved(id: string) {
    return this.deadLetterProvider.updateStatus(id, 'resolved');
  }

  async remove(id: string) {
    return this.deadLetterProvider.remove(id);
  }

  private dedupeLatest(jobs: DeadLetterJob[]): DeadLetterJob[] {
    const latest = new Map<string, DeadLetterJob>();
    const order: string[] = [];

    for (const job of jobs) {
      const key = `${job.queueName}::${job.jobId}`;
      const existing = latest.get(key);
      if (!existing) {
        latest.set(key, job);
        order.push(key);
      } else if (this.timestamp(job) > this.timestamp(existing)) {
        latest.set(key, job);
      }
    }

    return order.map((key) => latest.get(key) as DeadLetterJob);
  }

  private timestamp(job: DeadLetterJob): number {
    const value = job.lastAttemptAt ?? job.createdAt;
    return value ? new Date(value).getTime() : 0;
  }
}
