import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * BE-14 — Contact messages are soft-deleted via TypeORM's
 * `@DeleteDateColumn`. Default queries automatically exclude
 * soft-deleted messages; the admin surface exposes an opt-in endpoint
 * to inspect / restore them.
 */
@Entity('contact_messages')
@Index(['deletedAt'])
export class ContactMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 100 })
  fullName: string;

  @Column('varchar', { length: 254 })
  email: string;

  @Column('varchar', { length: 20, nullable: true })
  phone?: string;

  @Column('varchar', { length: 150, nullable: true })
  company?: string;

  @Column('varchar', { length: 200 })
  subject: string;

  @Column('text')
  message: string;

  @Column('varchar', { length: 64, nullable: true })
  ipAddress?: string;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
