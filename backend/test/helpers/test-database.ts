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
}