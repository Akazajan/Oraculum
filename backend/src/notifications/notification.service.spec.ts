import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService, NotificationEventType } from './notification.service';
import { EmailService } from '../email/email.service';
import { BadRequestException } from '@nestjs/common';

describe('NotificationService Template & Delivery Tests (#58 BE-49)', () => {
  let service: NotificationService;
  let emailService: any;

  beforeEach(async () => {
    emailService = {
      sendEmail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  describe('Template Rendering Suite', () => {
    it('should render BOOKING_CONFIRMED template with accurate substitutions', () => {
      const rendered = service.renderTemplate(NotificationEventType.BOOKING_CONFIRMED, {
        userName: 'Alex',
        workspaceName: 'Downtown Studio',
        bookingDate: '2026-08-01',
        totalAmount: '$150.00',
      });

      expect(rendered.subject).toBe('Booking Confirmed - Downtown Studio');
      expect(rendered.html).toContain('Hi Alex,');
      expect(rendered.html).toContain('Downtown Studio');
      expect(rendered.html).toContain('$150.00');
    });

    it('should render PAYMENT_FAILED template correctly', () => {
      const rendered = service.renderTemplate(NotificationEventType.PAYMENT_FAILED, {
        userName: 'Jordan',
        invoiceId: 'INV-9921',
        retryUrl: 'https://oraculum.app/pay/INV-9921',
      });

      expect(rendered.subject).toContain('INV-9921');
      expect(rendered.html).toContain('https://oraculum.app/pay/INV-9921');
    });

    it('should throw BadRequestException when required template variables are missing', () => {
      expect(() =>
        service.renderTemplate(NotificationEventType.BOOKING_CONFIRMED, {
          userName: 'Alex',
          workspaceName: '', // empty workspace
          bookingDate: '2026-08-01',
          totalAmount: '$150.00',
        } as any),
      ).toThrow(BadRequestException);
    });
  });

  describe('Delivery & Resilience Logic', () => {
    it('should successfully dispatch email when recipient and payload are valid', async () => {
      const success = await service.sendNotification(
        'user@example.com',
        NotificationEventType.WORKSPACE_INVITATION,
        {
          inviterName: 'Sarah',
          workspaceName: 'Innovate Hub',
          inviteUrl: 'https://oraculum.app/invite/token123',
        },
      );

      expect(success).toBe(true);
      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: "You've been invited to join Innovate Hub",
        html: expect.stringContaining('https://oraculum.app/invite/token123'),
      });
    });

    it('should reject delivery gracefully without throwing when email format is invalid', async () => {
      const result = await service.sendNotification(
        'invalid-email-address',
        NotificationEventType.PAYMENT_FAILED,
        {
          userName: 'Jordan',
          invoiceId: 'INV-100',
          retryUrl: 'https://oraculum.app/pay',
        },
      );

      expect(result).toBe(false);
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should handle downstream email service exceptions gracefully', async () => {
      emailService.sendEmail.mockRejectedValueOnce(new Error('SMTP connection timeout'));

      const result = await service.sendNotification(
        'valid@example.com',
        NotificationEventType.BOOKING_CONFIRMED,
        {
          userName: 'Alex',
          workspaceName: 'Desk 1',
          bookingDate: '2026-08-01',
          totalAmount: '$50.00',
        },
      );

      expect(result).toBe(false);
    });
  });
});