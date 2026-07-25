import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ReconciliationOutcome {
  MATCHED = 'matched',
  FIXED = 'fixed',
  FAILED = 'failed',
}

@Entity('reconciliation_reports')
@Index(['createdAt'])
export class ReconciliationReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  invoiceId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  paymentId: string | null;

  @Column({ type: 'varchar', length: 32 })
  invoiceStatus: string;

  @Column({ type: 'varchar', length: 32 })
  paymentStatus: string;

  @Column({ type: 'varchar', length: 16 })
  outcome: ReconciliationOutcome;

  @Column({ type: 'varchar', length: 500, nullable: true })
  message: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
