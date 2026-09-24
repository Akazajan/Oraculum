import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Bridges long-term booking payments to a feeless Nano (XNO) settlement rail.
 *
 * Mirrors the SorobanEscrowProvider interface so it can sit next to the
 * escrow contract as an additive provider without touching the payment
 * webhook. Nano has no on-chain escrow and no gas, so the received send
 * block hash IS the settlement receipt, and releasing never re-captures
 * value. Deterministic hash stubs keep the backend contract stable until
 * a Nano RPC client is added.
 *
 * Environment variables:
 * - `NANO_RPC_URL`: Nano node/RPC endpoint, defaulting to rpc.nano.to.
 * - `NANO_NETWORK`: network name, defaulting to `mainnet`.
 */
@Injectable()
export class NanoEscrowProvider {
  private readonly logger = new Logger(NanoEscrowProvider.name);
  private readonly rpcUrl: string;
  private readonly network: string;

  constructor(private readonly configService: ConfigService) {
    this.rpcUrl = this.configService.get<string>(
      'NANO_RPC_URL',
      'https://rpc.nano.to',
    );
    this.network = this.configService.get<string>('NANO_NETWORK', 'mainnet');
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
      `[Nano] createEscrow: ${escrowId} — ${amountKobo} kobo — ${depositorAddress} → ${beneficiaryAddress} (${this.network})`,
    );
    // Sends value immediately on the feeless rail; the send block hash is the receipt.
    return `nano_send_stub_${escrowId}`;
  }

  async releaseEscrow(escrowId: string): Promise<string> {
    this.logger.log(`[Nano] releaseEscrow: ${escrowId} — value already settled`);
    return `nano_release_stub_${escrowId}`;
  }

  async refundEscrow(escrowId: string): Promise<string> {
    this.logger.log(`[Nano] refundEscrow: ${escrowId}`);
    // A reverse send back to the depositor.
    return `nano_refund_stub_${escrowId}`;
  }

  async getEscrowStatus(escrowId: string): Promise<Record<string, unknown>> {
    this.logger.log(`[Nano] getEscrowStatus: ${escrowId}`);
    return { escrowId, status: 'stub', network: this.network, rpcUrl: this.rpcUrl };
  }
}