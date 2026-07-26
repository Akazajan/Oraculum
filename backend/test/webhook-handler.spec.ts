import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { WebhookService, WebhookPayload } from '../src/notifications/services/webhook.service';

describe('WebhookService & Retry Behavior (BE-48)', () => {
  let service: WebhookService;
  let httpService: HttpService;

  const validPayload: WebhookPayload = {
    eventId: 'evt_12345',
    eventType: 'USER_MODERATED',
    data: { userId: 'usr_789', action: 'BAN' },
  };

  const targetUrl = 'https://example.com/webhook';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
    httpService = module.get<HttpService>(HttpService);
  });

  describe('Payload Validation', () => {
    it('should throw BadRequestException for malformed or incomplete payload', () => {
      const invalidPayload = { eventId: 'evt_123' } as any;

      expect(() => service.validatePayload(invalidPayload)).toThrow(BadRequestException);
      expect(() => service.validatePayload(null as any)).toThrow(BadRequestException);
    });

    it('should pass validation for valid payload structure', () => {
      expect(() => service.validatePayload(validPayload)).not.toThrow();
    });
  });

  describe('Dispatch & Retry Logic', () => {
    it('should successfully deliver webhook on first attempt', async () => {
      const mockResponse: AxiosResponse = {
        data: { received: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, 'post').mockReturnValue(of(mockResponse));

      const result = await service.dispatchWithRetry(targetUrl, validPayload, 3, 10);

      expect(result).toBe(true);
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed if subsequent attempt passes', async () => {
      const mockResponse: AxiosResponse = {
        data: { received: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      jest
        .spyOn(httpService, 'post')
        .mockReturnValueOnce(throwError(() => new Error('Network Timeout')))
        .mockReturnValueOnce(of(mockResponse));

      const result = await service.dispatchWithRetry(targetUrl, validPayload, 3, 10);

      expect(result).toBe(true);
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });

    it('should fail after reaching maximum retry limit on persistent errors', async () => {
      jest
        .spyOn(httpService, 'post')
        .mockReturnValue(throwError(() => new Error('500 Internal Server Error')));

      await expect(
        service.dispatchWithRetry(targetUrl, validPayload, 3, 10),
      ).rejects.toThrow('Webhook delivery failed after 3 attempts');

      expect(httpService.post).toHaveBeenCalledTimes(3);
    });
  });
});