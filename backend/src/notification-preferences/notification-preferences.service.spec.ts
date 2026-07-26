import { NotificationPreferencesService } from './notification-preferences.service';
import { CreateNotificationPreferencesProvider } from './providers/create-notification-preferences.provider';
import { FindNotificationPreferencesProvider } from './providers/find-notification-preferences.provider';
import { NotificationChannel } from './enums/notification-channel.enum';
import { NotificationFrequency } from './enums/notification-frequency.enum';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let createProvider: jest.Mocked<CreateNotificationPreferencesProvider>;
  let findProvider: jest.Mocked<FindNotificationPreferencesProvider>;

  beforeEach(() => {
    createProvider = {
      createDefaultPreferences: jest.fn(),
      upsertPreference: jest.fn(),
    } as unknown as jest.Mocked<CreateNotificationPreferencesProvider>;

    findProvider = {
      findAll: jest.fn(),
      findByUserAndChannel: jest.fn(),
      isEnabled: jest.fn(),
      getFrequency: jest.fn(),
    } as unknown as jest.Mocked<FindNotificationPreferencesProvider>;

    service = new NotificationPreferencesService(createProvider, findProvider);
  });

  it('delegates createDefaultPreferences', async () => {
    const expected = [{ id: '1', userId: 'user-1' }];
    createProvider.createDefaultPreferences.mockResolvedValue(expected as never);

    const result = await service.createDefaultPreferences('user-1');
    expect(createProvider.createDefaultPreferences).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(expected);
  });

  it('delegates findAll', async () => {
    const expected = [{ id: '1', channel: NotificationChannel.EMAIL }];
    findProvider.findAll.mockResolvedValue(expected as never);

    const result = await service.findAll('user-1');
    expect(findProvider.findAll).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(expected);
  });

  it('delegates upsert', async () => {
    const dto = {
      channel: NotificationChannel.EMAIL,
      eventType: 'booking_confirmed',
      enabled: false,
      frequency: NotificationFrequency.DAILY,
    };
    const expected = { id: '1', ...dto };
    createProvider.upsertPreference.mockResolvedValue(expected as never);

    const result = await service.upsert('user-1', dto);
    expect(createProvider.upsertPreference).toHaveBeenCalledWith('user-1', {
      channel: dto.channel,
      eventType: dto.eventType,
      enabled: dto.enabled,
      frequency: dto.frequency,
    });
    expect(result).toEqual(expected);
  });

  it('delegates isEnabled', async () => {
    findProvider.isEnabled.mockResolvedValue(true);

    const result = await service.isEnabled(
      'user-1',
      NotificationChannel.EMAIL,
      'booking_confirmed',
    );
    expect(findProvider.isEnabled).toHaveBeenCalledWith(
      'user-1',
      NotificationChannel.EMAIL,
      'booking_confirmed',
    );
    expect(result).toBe(true);
  });

  it('delegates getFrequency', async () => {
    findProvider.getFrequency.mockResolvedValue('daily');

    const result = await service.getFrequency(
      'user-1',
      NotificationChannel.EMAIL,
      'booking_confirmed',
    );
    expect(findProvider.getFrequency).toHaveBeenCalledWith(
      'user-1',
      NotificationChannel.EMAIL,
      'booking_confirmed',
    );
    expect(result).toBe('daily');
  });
});
