import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { PaymentProvider } from '../enums/payment-provider.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

@Entity('payments')
@Index(['bookingId'])
@Index(['userId'])
@Index(['providerReference'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  bookingId: string;

  @ManyToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bookingId' })
  booking: Booking;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: User;

  /**
   * Captured amount in the smallest currency unit (kobo for NGN).
   * Stored as bigint; treat as integer arithmetic only (BE-47).
   */
  @Column({ type: 'bigint', transformer: {
    to: (v: number | string) => v,
    from: (v: string | number) => (v == null ? 0 : Number(v)),
  }})
  amount: number;

  /**
   * Cumulative amount refunded so far, same unit/currency as `amount`.
   * Full and partial refunds must keep `refundedAmount <= amount`.
   */
  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (v: number | string) => v ?? 0,
      from: (v: string | number) => (v == null ? 0 : Number(v)),
    },
  })
  refundedAmount: number;

  @Column({ type: 'varchar', length: 3, default: 'NGN' })
  currency: string;

  @Column({ type: 'enum', enum: PaymentProvider })
  provider: PaymentProvider;

  @Column({ nullable: true })
  providerReference: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Remaining refundable balance in minor units. */
  get refundableRemaining(): number {
    const captured = Number(this.amount) || 0;
    const refunded = Number(this.refundedAmount) || 0;
    return Math.max(0, captured - refunded);
  }
}
