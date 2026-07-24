import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContactMessage } from './entities/contact-message.entity';
import { SubmitContactDto } from './dto/submit-contact.dto';
import { EmailService } from '../email/email.service';
import { AuditAction, AuditService } from '../audit/audit.service';

/**
 * Contact form messages:
 *  - BE-03 — every submission is recorded in the audit log so admins can
 *    verify message volume / pattern when triaging spam.
 *  - BE-08 — submission events pick up the request IP / user-agent / cid
 *    automatically from the AsyncLocalStorage context.
 *  - BE-14 — `softDelete()` writes the `@DeleteDateColumn` so the
 *    submission disappears from default lists but stays available
 *    to the admin surface for inspection / restoration.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectRepository(ContactMessage)
    private readonly contactRepo: Repository<ContactMessage>,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

  async submit(
    dto: SubmitContactDto,
    ipAddress?: string | null,
  ): Promise<{ message: string }> {
    const contactMessage = this.contactRepo.create({
      ...dto,
      ipAddress: ipAddress || undefined,
    });

    await this.contactRepo.save(contactMessage);
    this.logger.log(`Contact form submitted by ${dto.email}: ${dto.subject}`);

    await this.auditService.log({
      action: AuditAction.CONTACT_SUBMITTED,
      resourceType: 'ContactMessage',
      resourceId: contactMessage.id,
      metadata: {
        email: dto.email,
        subject: dto.subject,
      },
    });

    // Send confirmation email to the user (non-blocking)
    this.emailService
      .sendContactConfirmation(dto.email, dto.fullName, dto.subject)
      .catch((err) =>
        this.logger.warn(`Failed to send contact confirmation: ${err.message}`),
      );

    // Notify admin (non-blocking)
    this.emailService
      .sendContactNotification(
        dto.fullName,
        dto.email,
        dto.subject,
        dto.message,
      )
      .catch((err) =>
        this.logger.warn(`Failed to send admin notification: ${err.message}`),
      );

    return { message: 'Your message has been sent successfully.' };
  }

  async listMessages(includeDeleted = false): Promise<ContactMessage[]> {
    return this.contactRepo.find({ withDeleted: includeDeleted });
  }

  async listDeleted(): Promise<ContactMessage[]> {
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .withDeleted()
      .where('c.deletedAt IS NOT NULL')
      .orderBy('c.createdAt', 'DESC');
    return qb.getMany();
  }

  async markRead(id: string): Promise<ContactMessage> {
    const message = await this.contactRepo.findOne({ where: { id } });
    if (!message) {
      throw new NotFoundException(`Contact message ${id} not found`);
    }
    if (!message.isRead) {
      message.isRead = true;
      await this.contactRepo.save(message);
      await this.auditService.adminAction(
        AuditAction.CONTACT_MARKED_READ,
        {},
        'ContactMessage',
        id,
      );
    }
    return message;
  }

  /**
   * BE-14 — soft-delete a contact message via TypeORM so admins can
   * still inspect / restore via the dedicated endpoint.
   */
  async softDelete(id: string): Promise<void> {
    const existing = await this.contactRepo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!existing) {
      throw new NotFoundException(`Contact message ${id} not found`);
    }
    if (existing.deletedAt) {
      return;
    }
    await this.contactRepo.softDelete(id);
    await this.auditService.adminAction(
      AuditAction.CONTACT_DELETED,
      {},
      'ContactMessage',
      id,
      { subject: existing.subject },
    );
  }

  async restore(id: string): Promise<ContactMessage> {
    const existing = await this.contactRepo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!existing) {
      throw new NotFoundException(`Contact message ${id} not found`);
    }
    if (!existing.deletedAt) {
      return existing;
    }
    await this.contactRepo.restore(id);
    await this.auditService.adminAction(
      AuditAction.CONTACT_RESTORED,
      {},
      'ContactMessage',
      id,
    );
    return await this.contactRepo.findOne({ where: { id } }) as ContactMessage;
  }
}
