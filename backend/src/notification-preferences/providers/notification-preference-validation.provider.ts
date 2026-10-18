import { Injectable, BadRequestException } from '@nestjs/common';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationFrequency } from '../enums/notification-frequency.enum';

const SUPPORTED_COMBINATIONS: Map<NotificationChannel, NotificationFrequency[]> = new Map([
  [NotificationChannel.IN_APP, [NotificationFrequency.INSTANT]],
  [NotificationChannel.EMAIL, [NotificationFrequency.INSTANT, NotificationFrequency.DAILY, NotificationFrequency.WEEKLY]],
  [NotificationChannel.SMS, [NotificationFrequency.INSTANT]],
]);

@Injectable()
export class NotificationPreferenceValidationProvider {
  validateCombination(channel: NotificationChannel, frequency: NotificationFrequency): void {
    const supported = SUPPORTED_COMBINATIONS.get(channel);
    if (!supported) {
      throw new BadRequestException(`Unsupported notification channel: ${channel}`);
    }

    if (!supported.includes(frequency)) {
      throw new BadRequestException(
        `Channel ${channel} does not support frequency ${frequency}. Supported: ${supported.join(', ')}`,
      );
    }
  }

  isSupported(channel: NotificationChannel, frequency: NotificationFrequency): boolean {
    const supported = SUPPORTED_COMBINATIONS.get(channel);
    if (!supported) return false;
    return supported.includes(frequency);
  }

  getSupportedFrequencies(channel: NotificationChannel): NotificationFrequency[] {
    return SUPPORTED_COMBINATIONS.get(channel) ?? [];
  }
}