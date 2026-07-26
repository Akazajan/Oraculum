import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationFrequency } from '../enums/notification-frequency.enum';

@Entity('notification_preferences')
@Unique(['userId', 'channel', 'eventType'])
@Index(['userId'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({
    type: 'enum',
    enum: NotificationFrequency,
    default: NotificationFrequency.INSTANT,
  })
  frequency: NotificationFrequency;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
