import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { EmailQueueProvider } from '../email-queue.provider';
import { EmailQueueProvider } from '../email-queue.provider';
import { getQueueToken } from '@nestjs/bull';

describe('EmailQueueProvider', () => {
  let provider: EmailQueueProvider;
  let queue: {
    add: jest.Mock;
    getJob: jest.Mock;
    getWaitingCount: jest.Mock;
    getActiveCount: jest.Mock;
    getCompletedCount: jest.Mock;
    getFailedCount: jest.Mock;
    getDelayedCount: jest.Mock;
  };

  beforeEach(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
      getWaitingCount: jest.fn().mockResolvedValue(5),
      getActiveCount: jest.fn().mockResolvedValue(2),
      getCompletedCount: jest.fn().mockResolvedValue(100),
      getFailedCount: jest.fn().mockResolvedValue(3),
      getDelayedCount: jest.fn().mockResolvedValue(1),
    };

    const mod = await Test.createTestingModule({
      providers: [
        EmailQueueProvider,
        { provide: getQueueToken('email'), useValue: queue },
      ],
    }).compile();

    provider = mod.get(EmailQueueProvider);
  });

  it('enqueueSendEmail adds a send-email job to the queue', async () => {
    const jobId = await provider.enqueueSendEmail({
      to: 'test@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
    });

    expect(queue.add).toHaveBeenCalledWith(
      'send-email',
      { to: 'test@example.com', subject: 'Welcome', html: '<p>Hello</p>' },
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

  it('enqueueSendTemplateEmail adds a send-template-email job', async () => {
    const jobId = await provider.enqueueSendTemplateEmail({
      to: 'test@example.com',
      subject: 'Welcome',
      templateName: 'verification-otp',
      placeholders: { otp: '123456', fullName: 'John Doe' },
    });

    expect(queue.add).toHaveBeenCalledWith(
      'send-template-email',
      expect.objectContaining({
        templateName: 'verification-otp',
      }),
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

  it('getJobStatus returns null for non-existent job', async () => {
  it('getJobStatus returns null if job not found', async () => {
    queue.getJob.mockResolvedValue(null);
    const result = await provider.getJobStatus('nonexistent');
    expect(result).toBeNull();
  });

  it('getJobStatus returns status for existing job', async () => {
    queue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: { success: true },
    });
    const result = await provider.getJobStatus('job-1');
    expect(result).toEqual({
      status: 'completed',
      data: { success: true },
    });
  });

  it('getJobCount returns queue counts', async () => {
    const counts = await provider.getJobCount();
    expect(counts).toEqual({
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 3,
      delayed: 1,
    });
  });
});
