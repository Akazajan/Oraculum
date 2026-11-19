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
import { Payment } from '../../payments/entities/payment.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';

@Entity('invoices')
@Index(['invoiceNumber'], { unique: true })
/**
 * BE-51 — One payment produces at most one invoice. Without this
 * constraint two concurrent generations for the same payment both pass
 * the "does an invoice already exist?" lookup and each insert its own
 * row, silently double-billing the customer. The unique index makes
 * the race visible at the database level; the provider catches the
 * violation and returns the row the winner created.
 */
@Index('IDX_invoices_payment_id_unique', ['paymentId'], {
  unique: true,
  where: '"paymentId" IS NOT NULL',
})
@Index(['userId'])
@Index(['bookingId'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human-readable invoice number, e.g. INV-00001 */
  @Column({ type: 'varchar', length: 20 })
  invoiceNumber: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column('uuid')
  bookingId: string;

  @ManyToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bookingId' })
  booking: Booking;

  @Column('uuid', { nullable: true })
  paymentId: string;

  @ManyToOne(() => Payment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;

  /** Amount in kobo */
  @Column({ type: 'bigint' })
  amountKobo: number;

  @Column({ type: 'varchar', length: 3, default: 'NGN' })
  currency: string;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.PENDING,
  })
  status: InvoiceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date;

  /** Snapshot of line items for immutable record-keeping */
  @Column({ type: 'jsonb', nullable: true })
  lineItems: Record<string, unknown>[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
