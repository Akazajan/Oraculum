import { Test, TestingModule } from '@nestjs/testing';
import { AdminAuditController } from './admin-audit.controller';
import { AuditLogService } from '../../common/services/audit-log.service';
import { AuditAction } from '../../common/dto/audit-log-query.dto';

describe('AdminAuditController', () => {
  let controller: AdminAuditController;
  let service: AuditLogService;

  const mockAuditService = {
    getAuditLogs: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'log-1',
          actorId: 'admin-123',
          targetId: 'user-456',
          action: AuditAction.USER_BAN,
          createdAt: new Date(),
        },
      ],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuditController],
      providers: [
        {
          provide: AuditLogService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    controller = module.get<AdminAuditController>(AdminAuditController);
    service = module.get<AuditLogService>(AuditLogService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return audit records with applied filters', async () => {
    const query = { actorId: 'admin-123', action: AuditAction.USER_BAN };
    const result = await controller.getAuditLogs(query);

    expect(service.getAuditLogs).toHaveBeenCalledWith(query);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].action).toEqual(AuditAction.USER_BAN);
  });
});