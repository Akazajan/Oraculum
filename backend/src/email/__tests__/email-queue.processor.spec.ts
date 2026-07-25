import { Test } from '@nestjs/testing';
import { EmailQueueProcessor } from '../processors/email-queue.processor';
import { EmailService } from '../email.service';

describe('EmailQueueProcessor', () => {
  let processor: EmailQueueProcessor;
  let emailService: { send: jest.Mock };

  beforeEach(async () => {
    emailService = { send: jest.fn().mockResolvedValue(true) };

    const mod = await Test.createTestingModule({
      providers: [
        EmailQueueProcessor,
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    processor = mod.get(EmailQueueProcessor);
  });

  it('handleSendEmail calls emailService.send and returns success', async () => {
    const job = {
      id: '1',
      data: {
        to: 'a@b.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      },
      progress: jest.fn(),
    };

    const result = await processor.handleSendEmail(job as any);

    expect(emailService.send).toHaveBeenCalledWith(
      'a@b.com',
      'Test',
      '<p>Hello</p>',
      undefined,
    );
    expect(job.progress).toHaveBeenCalledWith(100);
    expect(result).toEqual({ success: true, jobId: '1' });
  });

  it('handleSendEmail rethrows errors from emailService.send', async () => {
    emailService.send.mockRejectedValue(new Error('SMTP error'));
    const job = {
      id: '2',
      data: { to: 'a@b.com', subject: 'Test', html: '<p>Hello</p>' },
      progress: jest.fn(),
    };

    await expect(processor.handleSendEmail(job as any)).rejects.toThrow(
      'SMTP error',
    );
  });
});
