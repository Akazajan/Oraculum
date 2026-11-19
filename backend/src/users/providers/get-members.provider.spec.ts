import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GetMembersProvider } from './get-members.provider';
import { User } from '../entities/user.entity';
import { MembershipStatus } from '../enums/membership-status.enum';
import {
  MAX_MEMBER_PAGE,
  MAX_MEMBER_SEARCH_LENGTH,
  MemberQueryDto,
} from '../dto/member-query.dto';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from '../../common/dto/pagination.dto';

type QueryBuilderStub = Record<string, jest.Mock>;

function buildQueryBuilderStub(
  overrides: Partial<Record<string, unknown>> = {},
): QueryBuilderStub {
  const stub: QueryBuilderStub = {
    select: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
  };
  Object.assign(stub, overrides);
  return stub;
}

/** Mirrors the options used by `CentralizedValidationPipe`. */
const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
} as const;

async function validationErrorsFor(
  query: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(MemberQueryDto, query);
  const errors = await validate(dto, VALIDATION_OPTIONS);
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('GetMembersProvider (BE-18 — bounded member-list query parameters)', () => {
  let provider: GetMembersProvider;
  let qb: QueryBuilderStub;
  let repository: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    qb = buildQueryBuilderStub();
    repository = { createQueryBuilder: jest.fn().mockReturnValue(qb) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GetMembersProvider,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    provider = moduleRef.get(GetMembersProvider);
  });

  describe('defaults', () => {
    it('falls back to page 1 / limit 20 when no pagination is supplied', async () => {
      qb.getCount.mockResolvedValue(42);

      const result = await provider.getMembers({} as MemberQueryDto);

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(DEFAULT_LIMIT);
      expect(result).toMatchObject({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 42,
        totalPages: 3,
      });
    });

    it('computes totalPages from the effective limit', async () => {
      qb.getCount.mockResolvedValue(100);

      const result = await provider.getMembers({
        page: 1,
        limit: 30,
      } as MemberQueryDto);

      expect(result.totalPages).toBe(4);
    });

    it('translates the page number into the matching OFFSET', async () => {
      await provider.getMembers({ page: 4, limit: 25 } as MemberQueryDto);

      expect(qb.skip).toHaveBeenCalledWith(75);
      expect(qb.take).toHaveBeenCalledWith(25);
    });
  });

  describe('limits', () => {
    it('caps an oversized page size at MAX_LIMIT', async () => {
      const result = await provider.getMembers({
        page: 1,
        limit: 100_000,
      } as MemberQueryDto);

      expect(qb.take).toHaveBeenCalledWith(MAX_LIMIT);
      expect(result.limit).toBe(MAX_LIMIT);
    });

    it('clamps a zero or negative page size up to 1', async () => {
      for (const limit of [0, -5]) {
        jest.clearAllMocks();
        qb = buildQueryBuilderStub();
        repository.createQueryBuilder.mockReturnValue(qb);
        provider = new GetMembersProvider(repository as never);

        const result = await provider.getMembers({ limit } as MemberQueryDto);

        expect(result.limit).toBe(1);
        expect(qb.take).toHaveBeenCalledWith(1);
      }
    });

    it('truncates a fractional page size so take() always receives an integer', async () => {
      const result = await provider.getMembers({
        limit: 7.9,
      } as MemberQueryDto);

      expect(result.limit).toBe(7);
      expect(qb.take).toHaveBeenCalledWith(7);
    });

    it('falls back to the default page size for non-numeric input', async () => {
      for (const limit of ['abc', Number.NaN, Number.POSITIVE_INFINITY]) {
        jest.clearAllMocks();
        qb = buildQueryBuilderStub();
        repository.createQueryBuilder.mockReturnValue(qb);
        provider = new GetMembersProvider(repository as never);

        const result = await provider.getMembers({
          limit,
        } as unknown as MemberQueryDto);

        expect(result.limit).toBe(DEFAULT_LIMIT);
      }
    });

    it('never computes totalPages against a zero page size', async () => {
      qb.getCount.mockResolvedValue(7);

      const result = await provider.getMembers({ limit: 0 } as MemberQueryDto);

      expect(result.totalPages).toBe(7);
      expect(Number.isFinite(result.totalPages)).toBe(true);
    });
  });

  describe('page bounds', () => {
    it('caps an absurd page number so OFFSET stays finite', async () => {
      await provider.getMembers({
        page: 2_000_000_000,
        limit: 10,
      } as MemberQueryDto);

      expect(qb.skip).toHaveBeenCalledWith((MAX_MEMBER_PAGE - 1) * 10);
    });

    it('clamps a negative page number to the first page', async () => {
      const result = await provider.getMembers({ page: -3 } as MemberQueryDto);

      expect(result.page).toBe(DEFAULT_PAGE);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });
  });

  describe('filters', () => {
    it('applies the status filter', async () => {
      await provider.getMembers({
        status: MembershipStatus.ACTIVE,
      } as MemberQueryDto);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'user.membershipStatus = :status',
        { status: MembershipStatus.ACTIVE },
      );
    });

    it('normalises the search term and matches it case-insensitively', async () => {
      await provider.getMembers({ search: '  JaNe  ' } as MemberQueryDto);

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LIKE'),
        {
          search: '%jane%',
        },
      );
    });

    it('escapes LIKE wildcards so the search cannot widen the match', async () => {
      await provider.getMembers({ search: '100%_x' } as MemberQueryDto);

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('LIKE'),
        {
          search: '%100\\%\\_x%',
        },
      );
    });

    it('drops a whitespace-only search instead of filtering on "%%"', async () => {
      await provider.getMembers({ search: '   ' } as MemberQueryDto);

      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('ignores a non-string search term', async () => {
      await provider.getMembers({
        search: { toString: () => 'x' },
      } as unknown as MemberQueryDto);

      expect(qb.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('soft-deleted users', () => {
    it('excludes tombstones by default', async () => {
      await provider.getMembers({} as MemberQueryDto);

      expect(qb.withDeleted).not.toHaveBeenCalled();
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        'user.deletedAt IS NOT NULL',
      );
    });

    it('only surfaces tombstones when asked', async () => {
      await provider.getMembers({} as MemberQueryDto, true);

      expect(qb.withDeleted).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith('user.deletedAt IS NOT NULL');
    });
  });
});

describe('MemberQueryDto (BE-18 — validation)', () => {
  it('accepts an empty query and applies the shared defaults', async () => {
    expect(await validationErrorsFor({})).toEqual([]);

    const dto = plainToInstance(MemberQueryDto, {});
    expect(dto.page).toBe(DEFAULT_PAGE);
    expect(dto.limit).toBe(DEFAULT_LIMIT);
  });

  it('accepts a well-formed query', async () => {
    expect(
      await validationErrorsFor({
        page: '2',
        limit: '50',
        status: MembershipStatus.ACTIVE,
        search: 'jane',
      }),
    ).toEqual([]);
  });

  it('rejects a limit above the maximum page size', async () => {
    const errors = await validationErrorsFor({ limit: String(MAX_LIMIT + 1) });

    expect(errors).toContain('limit must be less than or equal to 100');
  });

  it('rejects a zero, negative or non-integer limit', async () => {
    expect(await validationErrorsFor({ limit: '0' })).toContain(
      'limit must be greater than or equal to 1',
    );
    expect(await validationErrorsFor({ limit: '-1' })).toContain(
      'limit must be greater than or equal to 1',
    );
    expect(await validationErrorsFor({ limit: 'abc' })).toContain(
      'limit must be an integer',
    );
  });

  it('rejects a page above the member page ceiling', async () => {
    expect(
      await validationErrorsFor({ page: String(MAX_MEMBER_PAGE + 1) }),
    ).toContain(`page must be less than or equal to ${MAX_MEMBER_PAGE}`);
  });

  it('rejects a non-integer or out-of-range page', async () => {
    expect(await validationErrorsFor({ page: '0' })).toContain(
      'page must be greater than or equal to 1',
    );
    expect(await validationErrorsFor({ page: 'first' })).toContain(
      'page must be an integer',
    );
  });

  it('rejects an unknown membership status', async () => {
    expect(await validationErrorsFor({ status: 'not-a-status' })).not.toEqual(
      [],
    );
  });

  it('rejects a search term longer than the allowed maximum', async () => {
    const errors = await validationErrorsFor({
      search: 'a'.repeat(MAX_MEMBER_SEARCH_LENGTH + 1),
    });

    expect(errors).toContain(
      `search must be at most ${MAX_MEMBER_SEARCH_LENGTH} characters`,
    );
  });

  it('trims the search term before it reaches the provider', () => {
    const dto = plainToInstance(MemberQueryDto, { search: '  jane  ' });

    expect(dto.search).toBe('jane');
  });

  it('rejects unknown query parameters', async () => {
    expect(await validationErrorsFor({ sortBy: 'password' })).not.toEqual([]);
  });
});
