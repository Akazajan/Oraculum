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
});
