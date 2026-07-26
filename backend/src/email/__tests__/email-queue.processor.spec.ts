import { Test } from '@nestjs/testing';
import { EmailQueueProcessor } from '../processors/email-queue.processor';
import { DeadLetterProvider } from '../../common/providers/dead-letter.provider';

describe('EmailQueueProcessor', () => {
  let processor: EmailQueueProcessor;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        EmailQueueProcessor,
        { provide: DeadLetterProvider, useValue: {} },
      ],
    }).compile();

    processor = mod.get(EmailQueueProcessor);
  });

  it('handleSendEmail returns success', async () => {
    const job = {
      id: '1',
      data: { to: 'a@b.com', subject: 'Test', html: '<p>Hi</p>' },
      progress: jest.fn(),
    };
    const result = await processor.handleSendEmail(job as any);
    expect(result.success).toBe(true);
    expect(job.progress).toHaveBeenCalledWith(100);
  });

  it('handleSendTemplateEmail returns success', async () => {
    const job = {
      id: '2',
      data: {
        to: 'a@b.com',
        subject: 'Test',
        templateName: 'welcome',
        placeholders: { name: 'A' },
      },
      progress: jest.fn(),
    };
    const result = await processor.handleSendTemplateEmail(job as any);
    expect(result.success).toBe(true);
    expect(job.progress).toHaveBeenCalledWith(100);
  });
});
