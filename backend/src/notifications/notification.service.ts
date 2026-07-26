import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { EmailService } from '../email/email.service';

export enum NotificationEventType {
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  WORKSPACE_INVITATION = 'WORKSPACE_INVITATION',
}

export interface NotificationPayloadMap {
  [NotificationEventType.BOOKING_CONFIRMED]: {
    userName: string;
    workspaceName: string;
    bookingDate: string;
    totalAmount: string;
  };
  [NotificationEventType.PAYMENT_FAILED]: {
    userName: string;
    invoiceId: string;
    retryUrl: string;
  };
  [NotificationEventType.WORKSPACE_INVITATION]: {
    inviterName: string;
    workspaceName: string;
    inviteUrl: string;
  };
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly emailService: EmailService) {}

  /**
   * Renders the HTML template dynamically based on event type and variable context.
   */
  renderTemplate<T extends NotificationEventType>(
    event: T,
    data: NotificationPayloadMap[T],
  ): { subject: string; html: string } {
    if (!data) {
      throw new BadRequestException('Template payload data cannot be empty.');
    }

    switch (event) {
      case NotificationEventType.BOOKING_CONFIRMED: {
        const payload = data as NotificationPayloadMap[NotificationEventType.BOOKING_CONFIRMED];
        this.validateRequiredFields(payload, ['userName', 'workspaceName', 'bookingDate', 'totalAmount']);
        return {
          subject: `Booking Confirmed - ${payload.workspaceName}`,
          html: `<p>Hi ${payload.userName},</p><p>Your booking for <strong>${payload.workspaceName}</strong> on ${payload.bookingDate} (${payload.totalAmount}) is confirmed!</p>`,
        };
      }

      case NotificationEventType.PAYMENT_FAILED: {
        const payload = data as NotificationPayloadMap[NotificationEventType.PAYMENT_FAILED];
        this.validateRequiredFields(payload, ['userName', 'invoiceId', 'retryUrl']);
        return {
          subject: `Action Required: Payment Failed for Invoice ${payload.invoiceId}`,
          html: `<p>Hi ${payload.userName},</p><p>Payment for invoice #${payload.invoiceId} failed. Please update your billing details <a href="${payload.retryUrl}">here</a>.</p>`,
        };
      }

      case NotificationEventType.WORKSPACE_INVITATION: {
        const payload = data as NotificationPayloadMap[NotificationEventType.WORKSPACE_INVITATION];
        this.validateRequiredFields(payload, ['inviterName', 'workspaceName', 'inviteUrl']);
        return {
          subject: `You've been invited to join ${payload.workspaceName}`,
          html: `<p>${payload.inviterName} invited you to collaborate on <strong>${payload.workspaceName}</strong>.</p><a href="${payload.inviteUrl}">Accept Invitation</a>`,
        };
      }

      default:
        throw new BadRequestException(`Unsupported notification event type: ${event}`);
    }
  }

  /**
   * Delivers a notification email after validating recipient formatting and rendering template.
   */
  async sendNotification<T extends NotificationEventType>(
    recipientEmail: string,
    event: T,
    data: NotificationPayloadMap[T],
  ): Promise<boolean> {
    if (!recipientEmail || !this.isValidEmail(recipientEmail)) {
      this.logger.warn(`Dispatch aborted: Invalid recipient email address "${recipientEmail}".`);
      return false;
    }

    try {
      const { subject, html } = this.renderTemplate(event, data);
      return await this.emailService.sendEmail({
        to: recipientEmail,
        subject,
        html,
      });
    } catch (err: any) {
      this.logger.error(`Failed to dispatch notification [${event}] to ${recipientEmail}: ${err.message}`);
      return false;
    }
  }

  private validateRequiredFields(payload: Record<string, any>, fields: string[]) {
    for (const field of fields) {
      if (!payload[field] || String(payload[field]).trim() === '') {
        throw new BadRequestException(`Missing required template variable: "${field}".`);
      }
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}