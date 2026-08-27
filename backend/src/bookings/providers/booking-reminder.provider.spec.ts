import { BookingReminderScheduler } from './booking-reminder.provider';
import { BookingStatus } from '../enums/booking-status.enum';

describe('BookingReminderScheduler', () => {
  const now = new Date('2026-03-08T06:00:00.000Z');
  const user = { email: 'user@example.com', fullName: 'Test User' };
  const baseBooking = {
    id: 'booking-id',
    status: BookingStatus.CONFIRMED,
    reminderSent: false,
    startDate: '2026-03-09',
    endDate: '2026-03-10',
    planType: 'DAILY',
    seatCount: 1,
    totalAmount: 10000,
    user,
    workspace: { name: 'Lagos Hub', timezone: 'Africa/Lagos' },
  } as any;

  function createScheduler(bookings = [baseBooking]) {
    const repository = {
      find: jest.fn().mockResolvedValue(bookings),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const emailService = {
      sendBookingReminderEmail: jest.fn().mockResolvedValue(true),
    };
    return {
      scheduler: new BookingReminderScheduler(repository as any, emailService as any),
      repository,
      emailService,
    };
  }

  it('handles the UTC offset when selecting a local booking date', async () => {
    const booking = { ...baseBooking, startDate: '2026-03-09' };
    const { scheduler, emailService } = createScheduler([booking]);

    await expect(scheduler.sendReminderEmails(now)).resolves.toBe(1);
    expect(emailService.sendBookingReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('uses the post-DST offset for a booking after the spring transition', async () => {
    const booking = {
      ...baseBooking,
      startDate: '2026-03-09',
      workspace: { name: 'New York Hub', timezone: 'America/New_York' },
    };
    const { scheduler, emailService } = createScheduler([booking]);

    await expect(
      scheduler.sendReminderEmails(new Date('2026-03-08T04:00:00.000Z')),
    ).resolves.toBe(1);
    expect(emailService.sendBookingReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('does not remind cancelled bookings', async () => {
    const booking = { ...baseBooking, status: BookingStatus.CANCELLED };
    const { scheduler, emailService, repository } = createScheduler([booking]);

    await expect(scheduler.sendReminderEmails(now)).resolves.toBe(0);
    expect(emailService.sendBookingReminderEmail).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});