import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingProvider } from './providers/create-booking.provider';
import { ConfirmBookingProvider } from './providers/confirm-booking.provider';
import { CancelBookingProvider } from './providers/cancel-booking.provider';
import { CompleteBookingProvider } from './providers/complete-booking.provider';
import { FindBookingsProvider } from './providers/find-bookings.provider';
import { ExportBookingsProvider } from './providers/export-bookings.provider';
import { PricingService } from './pricing/pricing.service';
import { UserRole } from '../users/enums/userRoles.enum';

describe('BookingsService', () => {
  let service: BookingsService;

  const createBookingProvider = { create: jest.fn() };
  const confirmBookingProvider = { confirm: jest.fn() };
  const cancelBookingProvider = { cancel: jest.fn() };
  const completeBookingProvider = { complete: jest.fn() };
  const findBookingsProvider = {
    findAll: jest.fn(),
    findById: jest.fn(),
  };
  const pricingService = {
    calculateAmount: jest.fn(),
    getPlanSummary: jest.fn(),
  };
  const exportBookingsProvider = {
    findAllForExport: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: CreateBookingProvider, useValue: createBookingProvider },
        { provide: ConfirmBookingProvider, useValue: confirmBookingProvider },
        { provide: CancelBookingProvider, useValue: cancelBookingProvider },
        { provide: CompleteBookingProvider, useValue: completeBookingProvider },
        { provide: FindBookingsProvider, useValue: findBookingsProvider },
        { provide: PricingService, useValue: pricingService },
        { provide: ExportBookingsProvider, useValue: exportBookingsProvider },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('exportCsv', () => {
    it('delegates to the export provider with the supplied filters', async () => {
      const rows = [{ id: 'b1' }];
      exportBookingsProvider.findAllForExport.mockResolvedValue(rows);

      const result = await service.exportCsv(
        'user-1',
        UserRole.USER,
        '2024-01-01',
        '2024-02-01',
      );

      expect(exportBookingsProvider.findAllForExport).toHaveBeenCalledWith(
        'user-1',
        UserRole.USER,
        '2024-01-01',
        '2024-02-01',
      );
      expect(result).toBe(rows);
    });

    it('propagates the row-cap error from the export provider', async () => {
      exportBookingsProvider.findAllForExport.mockRejectedValue(
        new BadRequestException(
          'Export exceeds the maximum allowed 10000 rows.',
        ),
      );

      await expect(service.exportCsv('user-1', UserRole.ADMIN)).rejects.toThrow(
        /maximum allowed 10000 rows/,
      );
    });
  });
});
