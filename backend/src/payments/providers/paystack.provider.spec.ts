import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { PaystackProvider } from './paystack.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const SECRET = 'test-secret-key';

function makeProvider(): PaystackProvider {
  const configService = {
    get: jest.fn().mockReturnValue(SECRET),
  } as unknown as ConfigService;
  return new PaystackProvider(configService);
}

describe('PaystackProvider', () => {
  describe('startup guard for PAYSTACK_SECRET_KEY (#201)', () => {
    function makeProviderWith(value: string | undefined): PaystackProvider {
      const configService = {
        get: jest.fn().mockReturnValue(value),
      } as unknown as ConfigService;
      return new PaystackProvider(configService);
    }

    it('throws when the env var is absent', () => {
      expect(() => makeProviderWith(undefined)).toThrow(
        'PAYSTACK_SECRET_KEY environment variable is not defined',
      );
    });

    it('throws when the env var is an empty string', () => {
      expect(() => makeProviderWith('')).toThrow(
        'PAYSTACK_SECRET_KEY environment variable is not defined',
      );
    });

    it('throws when the env var is only whitespace', () => {
      expect(() => makeProviderWith('   ')).toThrow(
        'PAYSTACK_SECRET_KEY environment variable is not defined',
      );
    });

    it('constructs successfully when the env var is set', () => {
      expect(makeProvider()).toBeDefined();
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns true for a valid signature', () => {
      const provider = makeProvider();
      const body = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const sig = crypto
        .createHmac('sha512', SECRET)
        .update(body)
        .digest('hex');
      expect(provider.verifyWebhookSignature(body, sig)).toBe(true);
    });

    it('returns false for a tampered signature', () => {
      const provider = makeProvider();
      const body = Buffer.from('payload');
      expect(provider.verifyWebhookSignature(body, 'bad-sig')).toBe(false);
    });
  });

  describe('initializeTransaction', () => {
    it('returns authorization_url and reference on success', async () => {
      const provider = makeProvider();
      const responseData = {
        authorization_url: 'https://paystack.com/pay/abc',
        access_code: 'ac_123',
        reference: 'ref_123',
      };
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue({ data: { data: responseData } });

      const result = await provider.initializeTransaction(
        'user@example.com',
        10000,
        'ref_123',
        'https://callback.test',
      );
      expect(result.authorization_url).toBe(responseData.authorization_url);
      expect(result.reference).toBe('ref_123');
    });

    it('sends Authorization: Bearer <secret key> on outgoing requests', async () => {
      const provider = makeProvider();
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { data: {} } });

      await provider.initializeTransaction(
        'user@example.com',
        10000,
        'ref_123',
        'https://callback.test',
      );

      const headers = (mockedAxios.post as jest.Mock).mock.calls[0][2].headers;
      expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    });

    it('propagates axios errors', async () => {
      const provider = makeProvider();
      mockedAxios.post = jest
        .fn()
        .mockRejectedValue(new Error('Network error'));
      await expect(
        provider.initializeTransaction('a@b.com', 100, 'r', 'https://cb.test'),
      ).rejects.toThrow('Network error');
    });
  });

  describe('initiateRefund', () => {
    it('posts to /refund and returns data', async () => {
      const provider = makeProvider();
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue({ data: { data: { id: 1 } } });
      const result = await provider.initiateRefund('ref_123', 5000);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/refund'),
        expect.objectContaining({ transaction: 'ref_123', amount: 5000 }),
        expect.any(Object),
      );
      expect(result).toEqual({ id: 1 });
    });
  });
});
