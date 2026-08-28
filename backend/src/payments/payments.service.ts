import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InitializePaymentProvider } from './providers/initialize-payment.provider';
import { HandleWebhookProvider } from './providers/handle-webhook.provider';
import { RefundPaymentProvider } from './providers/refund-payment.provider';
import {
  FindPaymentsProvider,
  PaymentQuery,
} from './providers/find-payments.provider';
import { UserRole } from '../users/enums/userRoles.enum';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly initializePaymentProvider: InitializePaymentProvider,
    private readonly handleWebhookProvider: HandleWebhookProvider,
    private readonly refundPaymentProvider: RefundPaymentProvider,
    private readonly findPaymentsProvider: FindPaymentsProvider,
  ) {}

  initialize(bookingId: string, userId: string) {
    this.logger.log(
      `Initializing payment for booking ${bookingId} by user ${userId}`,
      { bookingId, userId },
    );
    return this.initializePaymentProvider.initialize(bookingId, userId);
  }

  handleWebhook(rawBody: Buffer, signature: string) {
    let reference: string | undefined;
    try {
      const parsed = JSON.parse(rawBody.toString()) as {
        data?: { reference?: string };
      };
      reference = parsed?.data?.reference;
    } catch {
      // Body is validated/parsed by the provider; we only read the
      // reference here for traceability when it is safely available.
    }

    this.logger.log(
      `Payment webhook received${
        reference ? ` for reference ${reference}` : ''
      }`,
      { signaturePresent: Boolean(signature), reference },
    );
    return this.handleWebhookProvider.handle(rawBody, signature);
  }

  refund(paymentId: string, userId: string, userRole: UserRole) {
    this.logger.log(
      `Refund requested for payment ${paymentId} by user ${userId} (role: ${userRole})`,
      { paymentId, userId, userRole },
    );
    return this.refundPaymentProvider.refund(paymentId, userId, userRole);
  }

  findAll(query: PaymentQuery, userId: string, userRole: UserRole) {
    return this.findPaymentsProvider.findAll(query, userId, userRole);
  }

  async findById(paymentId: string, userId: string, userRole: UserRole) {
    const payment = await this.findPaymentsProvider.findById(
      paymentId,
      userId,
      userRole,
    );
    if (!payment) {
      throw new NotFoundException(`Payment "${paymentId}" not found`);
    }
    return payment;
  }
}
