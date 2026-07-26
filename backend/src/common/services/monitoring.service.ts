import { Injectable } from '@nestjs/common';

@Injectable()
export class MonitoringService {
  private sentryDsn = process.env.SENTRY_DSN;

  initializeSentry() {
    if (this.sentryDsn) {
      console.log('Sentry monitoring initialized');
    }
  }

  captureException(error: Error, context?: Record<string, any>) {
    const errorPayload = {
      message: error.message,
      stack: error.stack,
      context: context,
      timestamp: new Date().toISOString(),
    };
    console.log('Captured exception:', errorPayload);
  }

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    console.log(`[${level.toUpperCase()}] ${message}`);
  }

  setUserContext(userId: string, email: string) {
    console.log(`User context: ${userId} (${email})`);
  }
}
