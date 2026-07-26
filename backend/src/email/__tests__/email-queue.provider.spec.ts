import { Test } from '@nestjs/testing';
import { EmailQueueProvider } from '../email-queue.provider';
import { getQueueToken } from '@nestjs/bull';

describe('EmailQueueProvider', () => {
  let provider: EmailQueueProvider;
  let queue: {
    add: jest.Mock;
    getJob: jest.Mock;
  };

  beforeEach(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        EmailQueueProvider,
        { provide: getQueueToken('email'), useValue: queue },
      ],
    }).compile();

    provider = mod.get(EmailQueueProvider);
  });

  it('enqueueSendEmail adds a job to the queue', async () => {
    const jobId = await provider.enqueueSendEmail({
      to: 'a@b.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'send-email',
      { to: 'a@b.com', subject: 'Test', html: '<p>Hello</p>' },
      expect.objectContaining({ attempts: 3 }),
    );
    expect(jobId).toBe('job-1');
  });

  it('enqueueSendTemplateEmail adds a template job', async () => {
    const jobId = await provider.enqueueSendTemplateEmail({
      to: 'a@b.com',
      subject: 'Welcome',
      templateName: 'welcome',
      placeholders: { name: 'A' },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'send-template-email',
      expect.objectContaining({ templateName: 'welcome' }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(jobId).toBe('job-1');
  });

  it('getJobStatus returns null if job not found', async () => {
    queue.getJob.mockResolvedValue(null);
    const result = await provider.getJobStatus('nonexistent');
    expect(result).toBeNull();
  });
});
