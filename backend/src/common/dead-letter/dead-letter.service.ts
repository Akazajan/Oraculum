import { Injectable } from '@nestjs/common';
import { DeadLetterProvider } from '../providers/dead-letter.provider';

@Injectable()
export class DeadLetterService {
  constructor(private readonly deadLetterProvider: DeadLetterProvider) {}

  async findAll(options?: {
    queueName?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.deadLetterProvider.findAll(options);
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
}
