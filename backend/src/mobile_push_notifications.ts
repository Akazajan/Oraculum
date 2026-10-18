// Mobile push notification support for key events
import { Injectable } from '@nestjs/common';

export interface PushEvent {
  userId: string;
  title: string;
  message: string;
  data?: Record<string, any>;
}

export const MAX_PUSH_TITLE_LENGTH = 100;
export const MAX_PUSH_MESSAGE_LENGTH = 240;
export const MAX_PUSH_PAYLOAD_BYTES = 4096;
export const MAX_PUSH_DATA_KEYS = 20;
export const MAX_PUSH_DATA_KEY_LENGTH = 64;

@Injectable()
export class MobilePushService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendNotification(event: PushEvent): Promise<string> {
    this.validateEvent(event);
    return this.sendWithRetry(event, 3);
  }

  /**
   * B53 — Enforces payload size and field limits before any provider
   * call is made. Oversized or underspecified payloads fail fast with a
   * clear error; valid notifications preserve current delivery behavior.
   */
  private validateEvent(event: PushEvent): void {
    if (!event || typeof event !== 'object') {
      throw new Error('Push notification payload is required');
    }

    if (!event.userId || event.userId.trim() === '') {
      throw new Error('Push notification requires a userId');
    }

    if (!event.title || event.title.trim() === '') {
      throw new Error('Push notification requires a title');
    }

    if (!event.message || event.message.trim() === '') {
      throw new Error('Push notification requires a message');
    }

    if (event.title.length > MAX_PUSH_TITLE_LENGTH) {
      throw new Error(
        `Push title exceeds maximum length of ${MAX_PUSH_TITLE_LENGTH} characters`,
      );
    }

    if (event.message.length > MAX_PUSH_MESSAGE_LENGTH) {
      throw new Error(
        `Push message exceeds maximum length of ${MAX_PUSH_MESSAGE_LENGTH} characters`,
      );
    }

    if (event.data) {
      const keys = Object.keys(event.data);
      if (keys.length > MAX_PUSH_DATA_KEYS) {
        throw new Error(
          `Push payload data exceeds maximum of ${MAX_PUSH_DATA_KEYS} keys`,
        );
      }

      for (const key of keys) {
        if (key.length > MAX_PUSH_DATA_KEY_LENGTH) {
          throw new Error(
            `Push data key exceeds maximum length of ${MAX_PUSH_DATA_KEY_LENGTH}`,
          );
        }
      }
    }

    const payloadBytes = Buffer.byteLength(
      JSON.stringify({ title: event.title, message: event.message, data: event.data ?? {} }),
      'utf8',
    );

    if (payloadBytes > MAX_PUSH_PAYLOAD_BYTES) {
      throw new Error(
        `Push payload size ${payloadBytes} bytes exceeds the maximum of ${MAX_PUSH_PAYLOAD_BYTES} bytes`,
      );
    }
  }

  private async sendWithRetry(event: PushEvent, retries: number): Promise<string> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.attemptSend(event);
      } catch (err) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000));
        } else {
          console.error(`Push failed after ${retries} retries`, err);
          throw err;
        }
      }
    }
    throw new Error('Failed to send notification');
  }

  private async attemptSend(event: PushEvent): Promise<string> {
    return `notification-${Date.now()}`;
  }
}
