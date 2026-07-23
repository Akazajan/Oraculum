import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

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

    // nodemailer.createTransport returns whatever we pass back.
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

    // Stub template compilation so we don't touch the filesystem.
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
    expect(metrics.retries).toBe(1); // 2 attempts => 1 retry
  });
});
