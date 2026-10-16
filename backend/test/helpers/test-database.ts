import { PrismaClient } from '@prisma/client';

export class TestDatabaseHelper {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resets database state cleanly between test runs to guarantee determinism.
   */
  async cleanDatabase() {
    const tableNames = ['Payment', 'Booking', 'WorkspaceMember', 'Workspace', 'User'];

    for (const table of tableNames) {
      await this.prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`,
      );
    }
  }

  async createTestUser(override = {}) {
    return this.prisma.user.create({
      data: {
        email: `test-${Date.now()}-${Math.random()}@example.com`,
        name: 'Test Customer',
        passwordHash: 'hashed_password_123',
        ...override,
      },
    });
  }

  async createTestWorkspace(ownerId: string, override = {}) {
    return this.prisma.workspace.create({
      data: {
        name: 'Oraculum Test Hub',
        slug: `oraculum-${Date.now()}`,
        ownerId,
        hourlyRateCents: 5000, // $50.00/hr
        ...override,
      },
    });
  }

  /**
   * Returns a bounded page of workspace booking history with stable ordering
   * and a continuation indicator.
   */
  async getWorkspaceBookingHistory(
    workspaceId: string,
    options: { cursor?: string; limit?: number } = {},
  ) {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const cursor = options.cursor;

    const bookings = await this.prisma.booking.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = bookings.length > limit;
    const page = hasMore ? bookings.slice(0, limit) : bookings;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page,
      nextCursor,
      hasMore,
    };
  }
}
