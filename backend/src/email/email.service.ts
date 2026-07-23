import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { withRetry } from '../utils/retry.util';

interface RetryMetrics {
  attempts: number;
  succeeded: boolean;
  lastError?: string;
}

/**
 * Classifies SMTP/nodemailer errors so we retry only the transient ones
 * and bail out quickly on permanent failures.
 *
 * - Node socket errors (ECONNRESET, ETIMEDOUT, ...) → transient.
 * - SMTP 4xx response codes (greylist / try-again-later) → transient.
 * - SMTP 5xx response codes (auth failure, mailbox unknown, ...) and the
 *   rest → permanent; retrying will not help.
 */
function isTransientEmailError(error: any): boolean {
  if (!error) return false;
  const code: string | undefined = error?.code;
  const transientCodes = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EPIPE',
  ]);
  if (code && transientCodes.has(code)) return true;

  const responseCode: number | undefined = error?.responseCode;
  if (typeof responseCode === 'number') {
    // SMTP convention: 4xx = transient (e.g. 451 greylist),
    // 5xx = permanent (e.g. 535 auth failed, 550 mailbox unknown).
    if (responseCode >= 400 && responseCode < 500) return true;
  }

  const message: string = (error?.message || '').toLowerCase();
  if (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('socket hang up')
  ) {
    return true;
  }
  return false;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  /** Cumulative counters for observability (actionable signals). */
  private readonly metrics = {
    sent: 0,
    retries: 0,
    failed: 0,
  };

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: false,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  private compileTemplate(
    templateName: string,
    context: Record<string, any>,
  ): string {
    const templatePath = path.join(
      __dirname,
      'templates',
      `${templateName}.hbs`,
    );
    const source = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(source);
    return template(context);
  }

  private async send(
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }>,
  ): Promise<boolean> {
    const maxAttempts = this.configService.get<number>(
      'EMAIL_MAX_RETRIES',
      3, // default: one initial attempt + up to 2 retries
    );
    const baseDelayMs = this.configService.get<number>(
      'EMAIL_RETRY_BASE_DELAY_MS',
      500,
    );
    const maxDelayMs = this.configService.get<number>(
      'EMAIL_RETRY_MAX_DELAY_MS',
      5000,
    );

    const metrics: RetryMetrics = { attempts: 0, succeeded: false };

    try {
      await withRetry(
        async () => {
          metrics.attempts += 1;
          await this.transporter.sendMail({
            from: this.configService.get<string>('EMAIL_FROM'),
            to,
            subject,
            html,
            attachments,
          });
        },
        {
          maxAttempts,
          baseDelayMs,
          maxDelayMs,
          isRetryable: isTransientEmailError,
          onRetry: (error, attempt, delayMs) => {
            this.metrics.retries += 1;
            const err = error as { code?: string; message?: string };
            this.logger.warn(
              `Email send to ${to} failed (attempt ${attempt}): ` +
                `${err?.code ?? 'UNKNOWN'} ${err?.message ?? ''} — ` +
                `retrying in ${delayMs}ms`,
            );
          },
        },
      );

      metrics.succeeded = true;
      this.metrics.sent += 1;
      if (metrics.attempts > 1) {
        this.logger.log(
          `Email sent to ${to}: ${subject} (succeeded after ${metrics.attempts} attempts)`,
        );
      } else {
        this.logger.log(`Email sent to ${to}: ${subject}`);
      }
      return true;
    } catch (error) {
      metrics.succeeded = false;
      metrics.lastError =
        (error as any)?.message ?? 'Email provider error';
      this.metrics.failed += 1;
      const err = error as { code?: string; responseCode?: number };
      this.logger.error(
        `Email send to ${to} permanently failed after ${metrics.attempts} attempt(s): ` +
          `${err?.code ?? ''} ${err?.responseCode ?? ''} ${metrics.lastError}`,
      );
      return false;
    }
  }

  async sendVerificationEmail(
    email: string,
    otp: string,
    fullName: string,
  ): Promise<boolean> {
    const html = this.compileTemplate('verification-otp', { otp, fullName });
    return this.send(email, 'Verify Your Email', html);
  }

  async sendPasswordResetEmail(
    email: string,
    otp: string,
    fullName: string,
  ): Promise<boolean> {
    const html = this.compileTemplate('password-reset-otp', { otp, fullName });
    return this.send(email, 'Password Reset Code', html);
  }

  async sendVerificationLinkEmail(
    email: string,
    token: string,
    fullName: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
    const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    const html = this.compileTemplate('verification-link', {
      fullName,
      verifyUrl,
    });
    return this.send(email, 'Verify Your Email', html);
  }

  async sendPasswordResetLinkEmail(
    email: string,
    fullName: string,
    resetLink: string,
  ): Promise<boolean> {
    const html = this.compileTemplate('password-reset-link', {
      fullName,
      resetLink,
    });
    return this.send(email, 'Reset Your Password', html);
  }

  async sendPasswordResetSuccessEmail(
    email: string,
    fullName: string,
  ): Promise<boolean> {
    const html = this.compileTemplate('password-reset-success', { fullName });
    return this.send(email, 'Password Reset Successful', html);
  }

  async sendTemplateEmail(
    email: string,
    subject: string,
    templateName: string,
    placeholders: Record<string, any>,
  ): Promise<boolean> {
    const html = this.compileTemplate(templateName, placeholders);
    return this.send(email, subject, html);
  }

  async sendContactConfirmation(
    email: string,
    fullName: string,
    subject: string,
  ): Promise<boolean> {
    const html = this.compileTemplate('contact-confirmation', {
      fullName,
      subject,
    });
    return this.send(email, 'We received your message', html);
  }

  async sendContactNotification(
    fullName: string,
    email: string,
    subject: string,
    message: string,
  ): Promise<boolean> {
    const adminEmail =
      this.configService.get<string>('ADMIN_EMAIL') ||
      this.configService.get<string>('EMAIL_FROM');
    const html = this.compileTemplate('contact-notification', {
      fullName,
      email,
      subject,
      message,
    });
    return this.send(adminEmail, `New Contact: ${subject}`, html);
  }

  async sendBookingCreatedEmail(
    email: string,
    fullName: string,
    data: {
      bookingId: string;
      workspaceName: string;
      planType: string;
      startDate: string;
      endDate: string;
      seatCount: number;
      totalAmountNaira: string;
    },
  ): Promise<boolean> {
    const html = this.compileTemplate('booking-created', { fullName, ...data });
    return this.send(email, 'Booking Created — Oraculum', html);
  }

  async sendPaymentSuccessEmail(
    email: string,
    fullName: string,
    data: {
      bookingId: string;
      workspaceName: string;
      amountNaira: string;
      paidAt: string;
      invoiceNumber: string;
    },
  ): Promise<boolean> {
    const html = this.compileTemplate('payment-success', { fullName, ...data });
    return this.send(email, 'Payment Successful — Oraculum', html);
  }

  async sendPaymentFailedEmail(
    email: string,
    fullName: string,
    data: {
      paymentReference: string;
      amountNaira: string;
    },
  ): Promise<boolean> {
    const html = this.compileTemplate('payment-failed', { fullName, ...data });
    return this.send(email, 'Payment Failed — Oraculum', html);
  }

  async sendBookingCancelledEmail(
    email: string,
    fullName: string,
    data: {
      bookingId: string;
      workspaceName: string;
      startDate: string;
      endDate: string;
      cancelledBy: string;
    },
  ): Promise<boolean> {
    const html = this.compileTemplate('booking-cancelled', {
      fullName,
      ...data,
    });
    return this.send(email, 'Booking Cancelled — Oraculum', html);
  }

  async sendInvoiceReadyEmail(
    email: string,
    fullName: string,
    data: {
      invoiceNumber: string;
      amountNaira: string;
      paidAt: string;
    },
    pdfBuffer: Buffer,
  ): Promise<boolean> {
    const html = this.compileTemplate('invoice-ready', { fullName, ...data });
    return this.send(email, `Invoice ${data.invoiceNumber} — Oraculum`, html, [
      {
        filename: `${data.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ]);
  }

  /**
   * Returns cumulative counters for tests and metrics exports.
   * Exposed as a method so we don't need to add a `/metrics` controller
   * just for verification.
   */
  getMetrics() {
    return { ...this.metrics };
  }
}
