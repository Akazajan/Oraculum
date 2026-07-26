import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ReconciliationService } from './reconciliation.service';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Payment } from '../payments/entities/payment.entity';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { PaymentStatus } from '../payments/enums/payment-status.enum';
import { ReconciliationReport } from './entities/reconciliation-report.entity';
import { AuditService } from '../audit/audit.service';

describe('ReconciliationService', () => {
  let service: ReconciliationService;

  const mockInvoicesRepo = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((r) => r),
  };
  const mockPaymentsRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const mockReportsRepo = {
    save: jest.fn(),
    create: jest.fn((r) => r),
  };
  const mockAuditService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(Invoice), useValue: mockInvoicesRepo },
        { provide: getRepositoryToken(Payment), useValue: mockPaymentsRepo },
        { provide: getRepositoryToken(ReconciliationReport), useValue: mockReportsRepo },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(ReconciliationService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('reconcile', () => {
    it('fixes invoice PENDING when payment is SUCCESS', async () => {
      const invoice = {
        id: 'inv-1',
        invoiceNumber: 'INV-00001',
        status: InvoiceStatus.PENDING,
        paymentId: 'pay-1',
        paidAt: null,
      };
      const payment = {
        id: 'pay-1',
        status: PaymentStatus.SUCCESS,
        paidAt: new Date('2026-07-25'),
      };

      mockInvoicesRepo.find.mockResolvedValue([invoice]);
      mockPaymentsRepo.findOne.mockResolvedValue(payment);

      const result = await service.reconcile();

      expect(invoice.status).toBe(InvoiceStatus.PAID);
      expect(invoice.paidAt).toBeInstanceOf(Date);
      expect(mockInvoicesRepo.save).toHaveBeenCalledWith(invoice);
      expect(result.fixed).toBe(1);
      expect(result.matched).toBe(0);
    });

    it('fixes invoice PAID when payment is FAILED', async () => {
      const invoice = {
        id: 'inv-2',
        invoiceNumber: 'INV-00002',
        status: InvoiceStatus.PAID,
        paymentId: 'pay-2',
        paidAt: new Date(),
      };
      const payment = {
        id: 'pay-2',
        status: PaymentStatus.FAILED,
      };

      mockInvoicesRepo.find.mockResolvedValue([invoice]);
      mockPaymentsRepo.findOne.mockResolvedValue(payment);

      const result = await service.reconcile();

      expect(invoice.status).toBe(InvoiceStatus.VOID);
      expect(mockInvoicesRepo.save).toHaveBeenCalledWith(invoice);
      expect(result.fixed).toBe(1);
    });

    it('reports matched when statuses are consistent', async () => {
      const invoice = {
        id: 'inv-3',
        invoiceNumber: 'INV-00003',
        status: InvoiceStatus.PAID,
        paymentId: 'pay-3',
        paidAt: new Date(),
      };
      const payment = {
        id: 'pay-3',
        status: PaymentStatus.SUCCESS,
      };

      mockInvoicesRepo.find.mockResolvedValue([invoice]);
      mockPaymentsRepo.findOne.mockResolvedValue(payment);

      const result = await service.reconcile();

      expect(result.matched).toBe(1);
      expect(result.fixed).toBe(0);
    });

    it('reports failed when payment not found', async () => {
      const invoice = {
        id: 'inv-4',
        invoiceNumber: 'INV-00004',
        status: InvoiceStatus.PENDING,
        paymentId: 'pay-missing',
      };

      mockInvoicesRepo.find.mockResolvedValue([invoice]);
      mockPaymentsRepo.findOne.mockResolvedValue(null);

      const result = await service.reconcile();

      expect(result.failed).toBe(1);
    });

    it('skips invoices without paymentId', async () => {
      const invoice = {
        id: 'inv-5',
        invoiceNumber: 'INV-00005',
        status: InvoiceStatus.PENDING,
        paymentId: null,
      };

      mockInvoicesRepo.find.mockResolvedValue([invoice]);

      const result = await service.reconcile();

      expect(result.matched).toBe(0);
      expect(result.fixed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(1);
    });

    it('always logs audit entry', async () => {
      mockInvoicesRepo.find.mockResolvedValue([]);

      await service.reconcile();

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PAYMENT_RECONCILED',
          outcome: 'SUCCESS',
        }),
      );
    });
  });
});
