import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-04 — Add `family` and `revokedReason` to refresh_tokens.
 *
 * The rotation flow in `AuthService.refreshToken` links every refresh
 * token minted for one login session to a common `family` UUID. The
 * replay-detection then walks the family and revokes the entire
 * lineage when a revoked token is presented a second time.
 *
 * `revokedReason` lets audit trails distinguish "logout" from
 * "rotation" from "replay detected" without parsing free-text logs.
 *
 * Both columns are nullable so an in-place deploy stays green: existing
 * rows (issued without these columns) remain valid, and any row that
 * happens to be replayed before the deploy completes will fall back to
 * the safe no-op path documented in `revokeFamily`.
 */
export class AddFamilyAndRevokedReasonToRefreshToken1711900000000
  implements MigrationInterface
{
  name = 'AddFamilyAndRevokedReasonToRefreshToken1711900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN IF NOT EXISTS "family" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_family"
      ON "refresh_tokens" ("family")
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'refresh_tokens_revoked_reason_enum'
        ) THEN
          CREATE TYPE "refresh_tokens_revoked_reason_enum" AS ENUM (
            'logout', 'rotation', 'replay', 'password_reset', 'admin'
          );
        END IF;
      END$$
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN IF NOT EXISTS "revoked_reason"
      "refresh_tokens_revoked_reason_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      DROP COLUMN IF EXISTS "revoked_reason"
    `);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "refresh_tokens_revoked_reason_enum"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_family"`);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      DROP COLUMN IF EXISTS "family"
    `);
  }
}
