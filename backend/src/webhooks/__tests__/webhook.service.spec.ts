import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WebhookService } from '../webhook.service';
import { Webhook } from '../entities/webhook.entity';
import * as axios from 'axios';

jest.mock('axios');

describe('WebhookService', () => {
  let service: WebhookService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockImplementation((data) => ({
        id: 'uuid-1',
        ...data,
        failureCount: 0,
      })),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: getRepositoryToken(Webhook), useValue: repo },
      ],
    }).compile();

    service = mod.get(WebhookService);
  });

  it('generateSignature creates HMAC-SHA256 signature', () => {
    const payload = '{"event":"test"}';
    const secret = 'my-secret';
    const signature = service.generateSignature(payload, secret);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifySignature returns true for valid signature', () => {
    const payload = '{"event":"test"}';
    const secret = 'my-secret';
    const signature = service.generateSignature(payload, secret);
    expect(service.verifySignature(payload, signature, secret)).toBe(true);
  });

  it('verifySignature returns false for invalid signature', () => {
    const payload = '{"event":"test"}';
    const secret = 'my-secret';
    expect(service.verifySignature(payload, 'invalid', secret)).toBe(false);
  });

  it('createWebhook creates and saves a webhook', async () => {
    const result = await service.createWebhook({
      webhookUrl: 'https://example.com/hook',
      secret: 'secret',
      events: ['booking_confirmed'],
    });

    expect(repo.create).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
    expect(result.id).toBe('uuid-1');
  });

  it('findActiveWebhooksForEvent filters by active status', async () => {
    repo.find.mockResolvedValue([
      { id: '1', active: true, events: ['booking_confirmed'] },
      { id: '2', active: false, events: ['booking_confirmed'] },
    ]);

    const result = await service.findActiveWebhooksForEvent('booking_confirmed');
    expect(repo.find).toHaveBeenCalledWith({ where: { active: true } });
    expect(result.length).toBe(2);
  });

  it('deleteWebhook calls repo.delete', async () => {
    await service.deleteWebhook('uuid-1');
    expect(repo.delete).toHaveBeenCalledWith('uuid-1');
  });

  it('verifySignature returns false for mismatched-length signature without throwing', () => {
    expect(service.verifySignature('{}', 'abcd', 'secret')).toBe(false);
  });

  describe('signature verification failure during delivery', () => {
    const webhook = {
      id: 'wh-1',
      webhookUrl: 'https://example.com/hook',
      secret: 'secret',
      events: ['booking_confirmed'],
      active: true,
      retryEnabled: true,
      failureCount: 5,
    } as unknown as Webhook;

    const payload = {
      event: 'booking_confirmed',
      data: { id: 'b-1' },
      timestamp: new Date().toISOString(),
      webhookId: 'wh-1',
    };

    let post: jest.Mock;

    beforeEach(() => {
      post = axios.default.post as unknown as jest.Mock;
      post.mockReset();
      post.mockResolvedValue({ status: 200 });
      jest.spyOn(service, 'verifySignature').mockReturnValue(false);
    });

    it('stops processing and causes no delivery side effects', async () => {
      await (service as any).deliverWebhook(webhook, payload);

      expect(service.verifySignature).toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('triggerWebhooks does not send or update when verification fails', async () => {
      repo.find.mockResolvedValue([webhook]);

      await service.triggerWebhooks('booking_confirmed', { id: 'b-1' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(post).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
