import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Bridges long-term booking payments to the Soroban payment escrow contract.
 *
 * The Stellar SDK integration is intentionally represented by deterministic
 * transaction-hash stubs until the SDK client is added. The public methods
 * already match the calls made by the payment webhook, so replacing the
 * stubs with SDK transactions will not change the backend contract.
 *
 * Environment variables:
 * - `PAYMENT_ESCROW_CONTRACT_ID`: deployed payment escrow contract ID.
 * - `STELLAR_NETWORK`: Stellar network name, defaulting to `testnet`.
 * - `STELLAR_RPC_URL`: Soroban RPC endpoint, defaulting to the testnet URL.
 * - `STELLAR_BENEFICIARY_ADDRESS`: escrow beneficiary address. This value is
 *   read by the payment webhook when it creates an escrow.
 */
@Injectable()
export class SorobanEscrowProvider {
  private readonly logger = new Logger(SorobanEscrowProvider.name);
  private readonly contractId: string;
  private readonly network: string;
  private readonly rpcUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.contractId = this.configService.get<string>(
      'PAYMENT_ESCROW_CONTRACT_ID',
      '',
    );
    this.network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    this.rpcUrl = this.configService.get<string>(
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
  }

  async createEscrow(
    escrowId: string,
    depositorAddress: string,
    beneficiaryAddress: string,
    amountKobo: number,
    description: string,
    releaseAfterUnix: number,
  ): Promise<string> {
    this.logger.log(
      `[Soroban] createEscrow: ${escrowId} — ${amountKobo} kobo — release after ${releaseAfterUnix}`,
    );
    // TODO: implement with @stellar/stellar-sdk once installed
    // Return a placeholder tx hash for now
    return `soroban_stub_${escrowId}`;
  }

  async releaseEscrow(escrowId: string): Promise<string> {
    this.logger.log(`[Soroban] releaseEscrow: ${escrowId}`);
    return `soroban_release_stub_${escrowId}`;
  }

  async refundEscrow(escrowId: string): Promise<string> {
    this.logger.log(`[Soroban] refundEscrow: ${escrowId}`);
    return `soroban_refund_stub_${escrowId}`;
  }

  async getEscrowStatus(escrowId: string): Promise<Record<string, unknown>> {
    this.logger.log(`[Soroban] getEscrowStatus: ${escrowId}`);
    return { escrowId, status: 'stub' };
  }
}
