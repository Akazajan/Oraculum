import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export enum EscrowOutcomeStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  TIMED_OUT = 'timed_out',
}

export interface EscrowOutcome {
  escrowId: string;
  status: EscrowOutcomeStatus;
  /** True only for confirmed or definitively failed settlement. */
  final: boolean;
  /** True when the caller may safely retry reconciliation. */
  retryable: boolean;
  reason?: string;
}

const TRANSIENT_ERROR_PATTERN =
  /timeout|timed out|etimedout|econnreset|econnrefused|enotfound|socket hang up|network|rate limit|too many requests|\b(429|500|502|503|504)\b|try_again_later|unavailable/i;

/** Whether an RPC error is transient and therefore retryable. */
export function isTransientRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_ERROR_PATTERN.test(message);
}

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

  /**
   * Maps a raw escrow status payload to a normalized outcome. Unknown or stub
   * statuses stay pending so they are never reported as final settlement.
   */
  normalizeOutcome(
    escrowId: string,
    raw: Record<string, unknown>,
  ): EscrowOutcome {
    const value = String(raw?.status ?? '').toLowerCase();
    switch (value) {
      case 'confirmed':
      case 'success':
      case 'released':
      case 'refunded':
        return {
          escrowId,
          status: EscrowOutcomeStatus.CONFIRMED,
          final: true,
          retryable: false,
        };
      case 'failed':
      case 'error':
        return {
          escrowId,
          status: EscrowOutcomeStatus.FAILED,
          final: true,
          retryable: false,
          reason: raw?.reason ? String(raw.reason) : undefined,
        };
      case 'timed_out':
      case 'timeout':
        return {
          escrowId,
          status: EscrowOutcomeStatus.TIMED_OUT,
          final: false,
          retryable: true,
        };
      default:
        return {
          escrowId,
          status: EscrowOutcomeStatus.PENDING,
          final: false,
          retryable: true,
        };
    }
  }

  /**
   * Fetches the escrow state and returns a consistent outcome. Transient RPC
   * failures yield a retryable, non-final pending outcome; non-transient
   * failures yield a final failed outcome.
   */
  async reconcileEscrow(escrowId: string): Promise<EscrowOutcome> {
    try {
      const raw = await this.getEscrowStatus(escrowId);
      return this.normalizeOutcome(escrowId, raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (isTransientRpcError(error)) {
        this.logger.warn(
          `[Soroban] transient RPC failure for ${escrowId}: ${reason}`,
        );
        return {
          escrowId,
          status: EscrowOutcomeStatus.PENDING,
          final: false,
          retryable: true,
          reason,
        };
      }
      this.logger.error(`[Soroban] escrow ${escrowId} failed: ${reason}`);
      return {
        escrowId,
        status: EscrowOutcomeStatus.FAILED,
        final: true,
        retryable: false,
        reason,
      };
    }
  }
}
