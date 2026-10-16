import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export type Transactional<T> = (manager: EntityManager) => Promise<T>;

/**
 * Run `work` inside a TypeORM transaction.
 *
 * BE-12 acceptance: any throw inside `work` causes the transaction
 * to be rolled back, so entities are never left half-updated when
 * a later side-effect fails (e.g. webhook saves Payment then fails
 * to confirm Booking).
 *
 * B17 (#415): if rolling back also fails, the rollback error is logged
 * with context but the original operation error is still re-thrown, so
 * callers always receive the root cause of the failure.
 */
const logger = new Logger('RunInTransaction');

export async function runInTransaction<T>(
  dataSource: DataSource,
  work: Transactional<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    const result = await work(queryRunner.manager);
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    try {
      await queryRunner.rollbackTransaction();
    } catch (rollbackError) {
      logger.error(
        `Transaction rollback failed: ${
          rollbackError instanceof Error
            ? rollbackError.stack ?? rollbackError.message
            : String(rollbackError)
        }`,
      );
    }
    throw error;
  } finally {
    await queryRunner.release();
  }
}
