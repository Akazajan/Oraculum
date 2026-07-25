import { ContactService } from './contact.service';
import { ContactMessage } from './entities/contact-message.entity';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';

describe('ContactService bulk import', () => {
  let service: ContactService;
  let contactRepo: Partial<Repository<ContactMessage>> & {
    create: jest.Mock;
    save: jest.Mock;
  };
  let emailService: Partial<EmailService>;
  let auditService: Partial<AuditService>;

  beforeEach(() => {
    contactRepo = {
      create: jest.fn((payload) => payload),
      save: jest.fn(async (payload) => payload),
    };
    emailService = {};
    auditService = { log: jest.fn(async () => null) };

    service = new ContactService(
      contactRepo as Repository<ContactMessage>,
      emailService as EmailService,
      auditService as AuditService,
    );
  });

  it('imports valid rows and reports row-level validation errors', async () => {
    const csv = Buffer.from(
      'fullName,email,subject,message\nJane Doe,jane@example.com,Hello,This is a valid message\nBad Row,not-an-email,Hello,too short',
    );

    const result = await service.importContacts({
      originalname: 'contacts.csv',
      buffer: csv,
      mimetype: 'text/csv',
      size: csv.length,
    } as Express.Multer.File);

    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({ row: 2, message: expect.any(String) }),
    );
    expect(contactRepo.create).toHaveBeenCalledTimes(1);
    expect(contactRepo.save).toHaveBeenCalled();
  });
});
