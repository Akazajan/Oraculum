export interface PaymentRecord {
  id: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  externalId?: string;
  timestamp: Date;
}

export interface ProviderPayment {
  externalId: string;
  amount: number;
  status: string;
  settledAt: Date;
}

export class PaymentReconciliationService {
  reconcile(internal: PaymentRecord[], external: ProviderPayment[]): {
    matched: PaymentRecord[];
    unmatched: PaymentRecord[];
    discrepancies: string[];
  } {
    const matched: PaymentRecord[] = [];
    const discrepancies: string[] = [];

    for (const payment of internal) {
      const provider = external.find(p => p.externalId === payment.externalId);
      
      if (provider) {
        if (payment.amount !== provider.amount) {
          discrepancies.push(`Amount mismatch: ${payment.id}`);
        } else if (payment.status !== provider.status.toLowerCase()) {
          payment.status = provider.status.toLowerCase() as any;
        }
        matched.push(payment);
      }
    }

    const unmatched = internal.filter(
      p => !external.find(e => e.externalId === p.externalId)
    );

    return { matched, unmatched, discrepancies };
  }
}
