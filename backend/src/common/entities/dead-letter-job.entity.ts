import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('dead_letter_jobs')
@Index(['queueName', 'createdAt'])
@Index(['status'])
export class DeadLetterJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  queueName: string;

  @Column({ type: 'varchar', length: 100 })
  jobId: string;

  @Column({ type: 'varchar', length: 100 })
  jobName: string;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  attemptsResult: Record<string, unknown>;

  @Column({ type: 'text' })
  errorMessage: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: string;

  @Column({ type: 'int', default: 0 })
  totalAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lastAttemptAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  retriedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
