import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  EmailService,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from './email.service';

class FakeTransporter {
  public sendMail = jest.fn();
}

describe('EmailService retry behavior', () => {
  let service: EmailService;
  let transporter: FakeTransporter;
  let configGet: jest.Mock;

  beforeEach(async () => {
    transporter = new FakeTransporter();
    configGet = jest.fn((key: string, def?: any) => {
      const map: Record<string, any> = {
        SMTP_HOST: 'smtp.test',
        SMTP_PORT: 587,
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'pw',
        EMAIL_FROM: 'noreply@test',
        EMAIL_MAX_RETRIES: 3,
        EMAIL_RETRY_BASE_DELAY_MS: 1,
        EMAIL_RETRY_MAX_DELAY_MS: 5,
      };
      return key in map ? map[key] : def;
    });

    jest
      .spyOn(require('nodemailer'), 'createTransport')
      .mockReturnValue(transporter as any);

    const mod = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    service = mod.get(EmailService);

    jest
      .spyOn(service as any, 'compileTemplate')
      .mockReturnValue('<html></html>');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries on a transient code and succeeds when the next attempt works', async () => {
    transporter.sendMail
      .mockRejectedValueOnce(
        Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
      )
      .mockResolvedValueOnce({ messageId: 'ok' });

    const result = await service.sendVerificationEmail(
      'a@b.com',
      '123456',
      'A B',
    );
    expect(result).toBe(true);
    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
    const metrics = service.getMetrics();
    expect(metrics.sent).toBe(1);
    expect(metrics.retries).toBe(1);
    expect(metrics.failed).toBe(0);
  });

  it('does not retry when the error is permanent', async () => {
    transporter.sendMail.mockRejectedValue(
      Object.assign(new Error('auth failed'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    );

    const result = await service.sendVerificationEmail(
      'a@b.com',
      '123456',
      'A B',
    );
    expect(result).toBe(false);
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const metrics = service.getMetrics();
    expect(metrics.failed).toBe(1);
    expect(metrics.sent).toBe(0);
  });

  it('stops retrying once EMAIL_MAX_RETRIES is reached', async () => {
    configGet.mockImplementation((key: string, def?: any) => {
      const map: Record<string, any> = {
        SMTP_HOST: 'smtp.test',
        SMTP_PORT: 587,
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'pw',
        EMAIL_FROM: 'noreply@test',
        EMAIL_MAX_RETRIES: 2,
        EMAIL_RETRY_BASE_DELAY_MS: 1,
        EMAIL_RETRY_MAX_DELAY_MS: 5,
      };
      return key in map ? map[key] : def;
    });

    transporter.sendMail.mockRejectedValue(
      Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    );

    const result = await service.sendPasswordResetEmail(
      'a@b.com',
      '123456',
      'A B',
    );
    expect(result).toBe(false);
    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
    const metrics = service.getMetrics();
    expect(metrics.failed).toBe(1);
    expect(metrics.retries).toBe(1);
  });
});

describe('EmailService i18n support', () => {
  let service: EmailService;
  let transporter: FakeTransporter;

  beforeEach(async () => {
    transporter = new FakeTransporter();
    const configGet = jest.fn((key: string, def?: any) => {
      const map: Record<string, any> = {
        SMTP_HOST: 'smtp.test',
        SMTP_PORT: 587,
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'pw',
        EMAIL_FROM: 'noreply@test',
        EMAIL_MAX_RETRIES: 1,
        EMAIL_RETRY_BASE_DELAY_MS: 1,
        EMAIL_RETRY_MAX_DELAY_MS: 5,
      };
      return key in map ? map[key] : def;
    });

    jest
      .spyOn(require('nodemailer'), 'createTransport')
      .mockReturnValue(transporter as any);

    const mod = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    service = mod.get(EmailService);
    transporter.sendMail.mockResolvedValue({ messageId: 'ok' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes DEFAULT_LOCALE as "en"', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('exposes SUPPORTED_LOCALES containing "en" and "fr"', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('fr');
  });

  it('passes locale to compileTemplate for sendVerificationEmail', async () => {
    const compileSpy = jest
      .spyOn(service as any, 'compileTemplate')
      .mockReturnValue('<html></html>');

    await service.sendVerificationEmail('a@b.com', '123', 'Test User', 'fr');
    expect(compileSpy).toHaveBeenCalledWith(
      'verification-otp',
      { otp: '123', fullName: 'Test User' },
      'fr',
    );
  });

  it('passes locale to compileTemplate for sendPasswordResetEmail', async () => {
    const compileSpy = jest
      .spyOn(service as any, 'compileTemplate')
      .mockReturnValue('<html></html>');

    await service.sendPasswordResetEmail('a@b.com', '123', 'Test User', 'fr');
    expect(compileSpy).toHaveBeenCalledWith(
      'password-reset-otp',
      { otp: '123', fullName: 'Test User' },
      'fr',
    );
  });

  it('passes locale to compileTemplate for sendTemplateEmail', async () => {
    const compileSpy = jest
      .spyOn(service as any, 'compileTemplate')
      .mockReturnValue('<html></html>');

    await service.sendTemplateEmail(
      'a@b.com',
      'Test',
      'custom-template',
      { key: 'val' },
      'fr',
    );
    expect(compileSpy).toHaveBeenCalledWith(
      'custom-template',
      { key: 'val' },
      'fr',
    );
  });

  it('defaults to "en" when no locale is provided', async () => {
    const compileSpy = jest
      .spyOn(service as any, 'compileTemplate')
      .mockReturnValue('<html></html>');

    await service.sendVerificationEmail('a@b.com', '123', 'Test User');
    expect(compileSpy).toHaveBeenCalledWith(
      'verification-otp',
      { otp: '123', fullName: 'Test User' },
      undefined,
    );
  });

  it('resolveLocale falls back to "en" for unsupported locale', () => {
    const result = (service as any).resolveLocale('de');
    expect(result).toBe('en');
  });

  it('resolveLocale returns "en" when no locale is provided', () => {
    const result = (service as any).resolveLocale(undefined);
    expect(result).toBe('en');
  });

  it('resolveLocale returns "fr" for supported "fr" locale', () => {
    const result = (service as any).resolveLocale('fr');
    expect(result).toBe('fr');
  });

  it('resolveLocale returns "en" for "en" locale', () => {
    const result = (service as any).resolveLocale('en');
    expect(result).toBe('en');
  });

  it('passes locale through all send* methods', async () => {
    const compileSpy = jest
      .spyOn(service as any, 'compileTemplate')
      .mockReturnValue('<html></html>');

    await service.sendVerificationLinkEmail('a@b.com', 'tok', 'U', 'fr');
    expect(compileSpy).toHaveBeenLastCalledWith(
      'verification-link',
      expect.any(Object),
      'fr',
    );

    await service.sendPasswordResetLinkEmail('a@b.com', 'U', 'link', 'fr');
    expect(compileSpy).toHaveBeenLastCalledWith(
      'password-reset-link',
      expect.any(Object),
      'fr',
    );

    await service.sendPasswordResetSuccessEmail('a@b.com', 'U', 'fr');
    expect(compileSpy).toHaveBeenLastCalledWith(
      'password-reset-success',
      expect.any(Object),
      'fr',
    );

    await service.sendContactConfirmation('a@b.com', 'U', 'Subj', 'fr');
    expect(compileSpy).toHaveBeenLastCalledWith(
      'contact-confirmation',
      expect.any(Object),
      'fr',
    );

    await service.sendContactNotification('U', 'a@b.com', 'Subj', 'Msg', 'fr');
    expect(compileSpy).toHaveBeenLastCalledWith(
      'contact-notification',
      expect.any(Object),
      'fr',
    );

    await service.sendBookingCreatedEmail(
      'a@b.com',
      'U',
      {
        bookingId: '1',
        workspaceName: 'W',
        planType: 'P',
        startDate: '2025-01-01',
        endDate: '2025-02-01',
        seatCount: 2,
        totalAmountNaira: '10000',
      },
      'fr',
    );
    expect(compileSpy).toHaveBeenLastCalledWith(
      'booking-created',
      expect.any(Object),
      'fr',
    );

    await service.sendPaymentSuccessEmail(
      'a@b.com',
      'U',
      {
        bookingId: '1',
        workspaceName: 'W',
        amountNaira: '5000',
        paidAt: '2025-01-01',
        invoiceNumber: 'INV-001',
      },
      'fr',
    );
    expect(compileSpy).toHaveBeenLastCalledWith(
      'payment-success',
      expect.any(Object),
      'fr',
    );

    await service.sendPaymentFailedEmail(
      'a@b.com',
      'U',
      { paymentReference: 'ref', amountNaira: '5000' },
      'fr',
    );
    expect(compileSpy).toHaveBeenLastCalledWith(
      'payment-failed',
      expect.any(Object),
      'fr',
    );

    await service.sendBookingCancelledEmail(
      'a@b.com',
      'U',
      {
        bookingId: '1',
        workspaceName: 'W',
        startDate: '2025-01-01',
        endDate: '2025-02-01',
        cancelledBy: 'admin',
      },
      'fr',
    );
    expect(compileSpy).toHaveBeenLastCalledWith(
      'booking-cancelled',
      expect.any(Object),
      'fr',
    );

    await service.sendInvoiceReadyEmail(
      'a@b.com',
      'U',
      { invoiceNumber: 'INV-001', amountNaira: '5000', paidAt: '2025-01-01' },
      Buffer.from('pdf'),
      'fr',
    );
    expect(compileSpy).toHaveBeenLastCalledWith(
      'invoice-ready',
      expect.any(Object),
      'fr',
    );
  });
});
