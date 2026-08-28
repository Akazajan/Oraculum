import { ConfigService } from '@nestjs/config';
import { SorobanEscrowProvider } from './soroban-escrow.provider';

describe('SorobanEscrowProvider', () => {
  const configValues: Record<string, string> = {
    PAYMENT_ESCROW_CONTRACT_ID: 'CESCROW123',
    STELLAR_NETWORK: 'testnet',
    STELLAR_RPC_URL: 'https://rpc.example.test',
  };

  function createProvider() {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        configValues[key] ?? defaultValue,
      ),
    } as unknown as ConfigService;

    return {
      provider: new SorobanEscrowProvider(configService),
      configService,
    };
  }

  it('loads the Soroban contract configuration at construction time', () => {
    const { configService } = createProvider();

    expect(configService.get).toHaveBeenNthCalledWith(
      1,
      'PAYMENT_ESCROW_CONTRACT_ID',
      '',
    );
    expect(configService.get).toHaveBeenNthCalledWith(
      2,
      'STELLAR_NETWORK',
      'testnet',
    );
    expect(configService.get).toHaveBeenNthCalledWith(
      3,
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
  });

  it('returns the escrow transaction hash for a create request', async () => {
    const { provider } = createProvider();

    await expect(
      provider.createEscrow(
        'booking-123',
        'G depositor',
        'G beneficiary',
        25000,
        'Booking booking-123',
        1_750_000_000,
      ),
    ).resolves.toBe('soroban_stub_booking-123');
  });

  it.each([
    ['releaseEscrow', 'soroban_release_stub-booking-123'],
    ['refundEscrow', 'soroban_refund_stub-booking-123'],
  ])('returns the transaction hash for %s', async (operation, expectedHash) => {
    const { provider } = createProvider();
    const result =
      operation === 'releaseEscrow'
        ? await provider.releaseEscrow('booking-123')
        : await provider.refundEscrow('booking-123');

    expect(result).toBe(expectedHash);
  });

  it('returns the current escrow status payload', async () => {
    const { provider } = createProvider();

    await expect(provider.getEscrowStatus('booking-123')).resolves.toEqual({
      escrowId: 'booking-123',
      status: 'stub',
    });
  });
});
