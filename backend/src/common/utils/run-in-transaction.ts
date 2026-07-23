import { DataSource, EntityManager } from 'typeorm';

export type Transactional<T> = (manager: EntityManager) => Promise<T>;

/**
 * Run `work` inside a TypeORM transaction.
 *
 * BE-12 acceptance: any throw inside `work` causes the transaction
 * to be rolled back, so entities are never left half-updated when
 * a later side-effect fails (e.g. webhook saves Payment then fails
 * to confirm Booking).
 */
export async function runInTransaction<T>(
  dataSource: DataSource,
  work: Transactional<T>,
): Promise<T> {
  return dataSource.transaction(work);
}
