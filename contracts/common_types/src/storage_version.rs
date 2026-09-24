//! # Storage Versioning for Contract Upgrades
//!
//! Provides a `StorageVersion` struct and migration helpers that allow
//! Oraculum contracts to track their storage schema version. This enables
//! safe, incremental upgrades: each new contract version bumps the storage
//! version and can run migration logic to transform existing data.
//!
//! ## Upgrade guards
//!
//! Storage-version upgrades are intentionally strict:
//! - **Downgrades fail** — the target must be greater than the current version.
//! - **Unsupported jumps fail** — only a single-step bump (`current + 1`) is allowed.
//! - **Version commits after migration** — prefer [`StorageVersionManager::migrate_with`]:
//!   the stored version is updated only when the migration callback returns `Ok`.
//!
//! ## Usage
//!
//! ```rust,ignore
//! use common_types::storage_version::{StorageVersion, StorageVersionManager};
//!
//! // At contract initialization:
//! StorageVersionManager::initialize(&env, 1);
//!
//! // Safe upgrade: migrate data first, then commit the new version.
//! StorageVersionManager::migrate_with(&env, 2, |env| {
//!     // transform storage schema for v2…
//!     Ok(())
//! })?;
//! ```

use soroban_sdk::{contracttype, symbol_short, Env, String};

/// Storage key for version tracking within a contract's instance storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VersionStorageKey {
    /// The current storage schema version number.
    CurrentVersion,
    /// Timestamp of the last migration.
    LastMigrationAt,
    /// Admin address authorized to trigger migrations.
    MigrationAdmin,
    /// Human-readable label for the current version (e.g., "v1.2.0").
    VersionLabel,
}

/// Metadata about the storage version, returned by queries.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageVersion {
    /// Numeric version (monotonically increasing).
    pub version: u32,
    /// Optional human-readable label (e.g., "v2.1.0").
    pub label: String,
    /// Ledger timestamp when this version was set.
    pub set_at: u64,
}

/// Result of a migration operation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationResult {
    /// Version before migration.
    pub from_version: u32,
    /// Version after migration.
    pub to_version: u32,
    /// Whether the migration actually ran (false if already at target version).
    pub migrated: bool,
    /// Timestamp when migration completed.
    pub completed_at: u64,
}

/// Manager for contract storage versioning.
///
/// All methods are stateless helpers that read/write to the contract's
/// instance storage. Each contract should call these at initialization
/// and before performing upgrade logic.
pub struct StorageVersionManager;

impl StorageVersionManager {
    /// Initialize the storage version system for a contract.
    ///
    /// Sets the current version to the given value and records the admin
    /// and timestamp. Fails if already initialized to prevent accidental
    /// re-initialization.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `initial_version` - Starting version number (typically 1)
    ///
    /// # Errors
    /// Returns `Err(())` if the version system is already initialized.
    pub fn initialize(env: &Env, initial_version: u32) -> Result<(), ()> {
        if Self::is_initialized(env) {
            return Err(());
        }

        let timestamp = env.ledger().timestamp();

        env.storage().instance().set(
            &VersionStorageKey::CurrentVersion,
            &initial_version,
        );

        env.storage()
            .instance()
            .set(&VersionStorageKey::LastMigrationAt, &timestamp);

        env.events().publish(
            (symbol_short!("sv_init"), initial_version),
            timestamp,
        );

        Ok(())
    }

    /// Initialize with an admin address and a version label.
    ///
    /// Extended version of `initialize` that also stores the migration admin
    /// and a human-readable version label.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `initial_version` - Starting version number
    /// * `admin` - Address authorized to trigger future migrations
    /// * `label` - Human-readable version label (e.g., "v1.0.0")
    pub fn initialize_with_admin(
        env: &Env,
        initial_version: u32,
        admin: &soroban_sdk::Address,
        label: String,
    ) -> Result<(), ()> {
        if Self::is_initialized(env) {
            return Err(());
        }

        let timestamp = env.ledger().timestamp();

        env.storage().instance().set(
            &VersionStorageKey::CurrentVersion,
            &initial_version,
        );
        env.storage()
            .instance()
            .set(&VersionStorageKey::MigrationAdmin, admin);
        env.storage()
            .instance()
            .set(&VersionStorageKey::VersionLabel, &label);
        env.storage()
            .instance()
            .set(&VersionStorageKey::LastMigrationAt, &timestamp);

        env.events().publish(
            (symbol_short!("sv_init"), initial_version),
            (admin.clone(), label),
        );

        Ok(())
    }

    /// Check whether the storage version system has been initialized.
    pub fn is_initialized(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<VersionStorageKey, u32>(&VersionStorageKey::CurrentVersion)
            .is_some()
    }

    /// Get the current storage version number.
    ///
    /// Returns 0 if the version system has not been initialized, allowing
    /// callers to handle the un-initialized case gracefully.
    pub fn get_version(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&VersionStorageKey::CurrentVersion)
            .unwrap_or(0)
    }

    /// Get the full `StorageVersion` metadata for the current version.
    pub fn get_version_info(env: &Env) -> StorageVersion {
        let version = Self::get_version(env);
        let label: String = env
            .storage()
            .instance()
            .get(&VersionStorageKey::VersionLabel)
            .unwrap_or_else(|| String::from_str(&env, "unknown"));
        let set_at: u64 = env
            .storage()
            .instance()
            .get(&VersionStorageKey::LastMigrationAt)
            .unwrap_or(0);

        StorageVersion {
            version,
            label,
            set_at,
        }
    }

    /// Get the migration admin address, if one was set during initialization.
    pub fn get_migration_admin(env: &Env) -> Option<soroban_sdk::Address> {
        env.storage()
            .instance()
            .get(&VersionStorageKey::MigrationAdmin)
    }

    /// Check whether the contract needs migration to a target version.
    ///
    /// Returns `true` if the current version is strictly less than the target.
    pub fn needs_migration(env: &Env, target_version: u32) -> bool {
        Self::get_version(env) < target_version
    }

    /// Validate that `target_version` is a supported upgrade from the current version.
    ///
    /// # Errors
    /// * `Err(())` on **downgrade** (`target < current`) or no-op (`target == current`)
    /// * `Err(())` on **unsupported jump** (`target != current + 1`)
    pub fn validate_upgrade(env: &Env, target_version: u32) -> Result<(), ()> {
        let current = Self::get_version(env);

        // Downgrades (and staying put) are never allowed.
        if target_version <= current {
            return Err(());
        }

        // Only a single-step bump is a supported storage-version jump.
        if target_version != current.saturating_add(1) {
            return Err(());
        }

        Ok(())
    }

    /// Persist a successful migration: bump the stored version and timestamp.
    ///
    /// Callers must have already validated the upgrade and completed data migration.
    fn commit_migration(
        env: &Env,
        current_version: u32,
        target_version: u32,
    ) -> MigrationResult {
        let timestamp = env.ledger().timestamp();

        env.storage().instance().set(
            &VersionStorageKey::CurrentVersion,
            &target_version,
        );
        env.storage()
            .instance()
            .set(&VersionStorageKey::LastMigrationAt, &timestamp);

        env.events().publish(
            (symbol_short!("sv_migr"), current_version, target_version),
            timestamp,
        );

        MigrationResult {
            from_version: current_version,
            to_version: target_version,
            migrated: true,
            completed_at: timestamp,
        }
    }

    /// Commit an already-completed migration to the target version.
    ///
    /// Prefer [`Self::migrate_with`] when migration logic can run inside the
    /// helper — that API updates the stored version **only after** the
    /// migration callback succeeds. Use `migrate_to` when data has already
    /// been transformed successfully and only the version stamp remains.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `target_version` - The version to migrate to (must be `current + 1`)
    ///
    /// # Returns
    /// * `Ok(MigrationResult)` with migration details
    /// * `Err(())` on downgrade or unsupported jump
    pub fn migrate_to(env: &Env, target_version: u32) -> Result<MigrationResult, ()> {
        Self::validate_upgrade(env, target_version)?;
        let current_version = Self::get_version(env);
        Ok(Self::commit_migration(env, current_version, target_version))
    }

    /// Run migration logic, then update the stored version only on success.
    ///
    /// 1. Rejects downgrades and unsupported jumps via [`Self::validate_upgrade`].
    /// 2. Invokes `migrate_fn`. If it returns `Err`, storage version is **unchanged**.
    /// 3. On `Ok`, commits `target_version` to instance storage.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `target_version` - Must be exactly `current + 1`
    /// * `migrate_fn` - Data / schema migration; must be idempotent-safe on retry
    pub fn migrate_with<F>(
        env: &Env,
        target_version: u32,
        migrate_fn: F,
    ) -> Result<MigrationResult, ()>
    where
        F: FnOnce(&Env) -> Result<(), ()>,
    {
        Self::validate_upgrade(env, target_version)?;
        let current_version = Self::get_version(env);

        // Version stays at `current_version` if migration fails.
        migrate_fn(env)?;

        Ok(Self::commit_migration(env, current_version, target_version))
    }

    /// Perform a migration with a new version label.
    ///
    /// Runs through [`Self::migrate_with`] so the label and version are written
    /// only after a successful (no-op) migration step — callers that need
    /// custom data transforms should call `migrate_with` directly.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `target_version` - The version to migrate to
    /// * `label` - New human-readable version label
    pub fn migrate_to_with_label(
        env: &Env,
        target_version: u32,
        label: String,
    ) -> Result<MigrationResult, ()> {
        Self::migrate_with(env, target_version, |env| {
            env.storage()
                .instance()
                .set(&VersionStorageKey::VersionLabel, &label);
            Ok(())
        })
    }

    /// Attempt a migration only if the contract needs it.
    ///
    /// If the contract is already at or beyond the target version, returns
    /// a `MigrationResult` with `migrated: false` instead of failing.
    /// Unsupported jumps (target ≠ current + 1) also return `migrated: false`
    /// without mutating the stored version.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `target_version` - The version to migrate to
    pub fn try_migrate(env: &Env, target_version: u32) -> MigrationResult {
        let current_version = Self::get_version(env);
        let timestamp = env.ledger().timestamp();

        if current_version >= target_version {
            return MigrationResult {
                from_version: current_version,
                to_version: current_version,
                migrated: false,
                completed_at: timestamp,
            };
        }

        match Self::migrate_to(env, target_version) {
            Ok(result) => result,
            Err(()) => MigrationResult {
                from_version: current_version,
                to_version: current_version,
                migrated: false,
                completed_at: timestamp,
            },
        }
    }

    /// Validate that a target version is reachable from the current version.
    ///
    /// Returns `Ok(())` if the target version is exactly one greater than the
    /// current version (incremental migration), or `Err(())` if the gap is
    /// larger (multi-step migration required) or the target is not an upgrade.
    pub fn validate_incremental_migration(env: &Env, target_version: u32) -> Result<(), ()> {
        Self::validate_upgrade(env, target_version)
    }

    /// Get the number of versions the contract is behind.
    ///
    /// Useful for determining if a multi-step migration is needed.
    /// Returns 0 if the contract is up-to-date relative to the target.
    pub fn versions_behind(env: &Env, target_version: u32) -> u32 {
        let current = Self::get_version(env);
        target_version.saturating_sub(current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialize_and_get_version() {
        let env = Env::default();
        env.as(|| {
            assert!(!StorageVersionManager::is_initialized(&env));
            assert_eq!(StorageVersionManager::get_version(&env), 0);

            StorageVersionManager::initialize(&env, 1).unwrap();

            assert!(StorageVersionManager::is_initialized(&env));
            assert_eq!(StorageVersionManager::get_version(&env), 1);
        });
    }

    #[test]
    fn test_initialize_fails_if_already_initialized() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            assert!(StorageVersionManager::initialize(&env, 2).is_err());
        });
    }

    #[test]
    fn test_migrate_to() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();

            let result = StorageVersionManager::migrate_to(&env, 2).unwrap();
            assert!(result.migrated);
            assert_eq!(result.from_version, 1);
            assert_eq!(result.to_version, 2);
            assert_eq!(StorageVersionManager::get_version(&env), 2);
        });
    }

    #[test]
    fn test_migrate_to_fails_on_downgrade() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 2).unwrap();
            assert!(StorageVersionManager::migrate_to(&env, 2).is_err());
            assert!(StorageVersionManager::migrate_to(&env, 1).is_err());
            assert_eq!(StorageVersionManager::get_version(&env), 2);
        });
    }

    #[test]
    fn test_migrate_to_fails_on_unsupported_jump() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            // Skipping v2 is an unsupported jump.
            assert!(StorageVersionManager::migrate_to(&env, 3).is_err());
            assert!(StorageVersionManager::migrate_to(&env, 5).is_err());
            assert_eq!(StorageVersionManager::get_version(&env), 1);
        });
    }

    #[test]
    fn test_migrate_with_updates_version_only_after_success() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();

            let result = StorageVersionManager::migrate_with(&env, 2, |_env| Ok(())).unwrap();
            assert!(result.migrated);
            assert_eq!(result.from_version, 1);
            assert_eq!(result.to_version, 2);
            assert_eq!(StorageVersionManager::get_version(&env), 2);
        });
    }

    #[test]
    fn test_migrate_with_leaves_version_unchanged_on_failure() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();

            let err = StorageVersionManager::migrate_with(&env, 2, |_env| Err(()));
            assert!(err.is_err());
            // Current version must not advance when migration fails.
            assert_eq!(StorageVersionManager::get_version(&env), 1);
        });
    }

    #[test]
    fn test_migrate_with_rejects_downgrade_and_jump_before_callback() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 2).unwrap();
            let mut called = false;
            assert!(StorageVersionManager::migrate_with(&env, 1, |_env| {
                called = true;
                Ok(())
            })
            .is_err());
            assert!(!called);
            assert_eq!(StorageVersionManager::get_version(&env), 2);

            assert!(StorageVersionManager::migrate_with(&env, 4, |_env| {
                called = true;
                Ok(())
            })
            .is_err());
            assert!(!called);
            assert_eq!(StorageVersionManager::get_version(&env), 2);
        });
    }

    #[test]
    fn test_try_migrate_already_at_target() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 3).unwrap();
            let result = StorageVersionManager::try_migrate(&env, 3);
            assert!(!result.migrated);
            assert_eq!(result.from_version, 3);
            assert_eq!(result.to_version, 3);
        });
    }

    #[test]
    fn test_try_migrate_needs_migration() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            let result = StorageVersionManager::try_migrate(&env, 2);
            assert!(result.migrated);
            assert_eq!(result.from_version, 1);
            assert_eq!(result.to_version, 2);
            assert_eq!(StorageVersionManager::get_version(&env), 2);
        });
    }

    #[test]
    fn test_try_migrate_unsupported_jump_does_not_mutate() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            let result = StorageVersionManager::try_migrate(&env, 5);
            assert!(!result.migrated);
            assert_eq!(result.from_version, 1);
            assert_eq!(result.to_version, 1);
            assert_eq!(StorageVersionManager::get_version(&env), 1);
        });
    }

    #[test]
    fn test_needs_migration() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            assert!(StorageVersionManager::needs_migration(&env, 2));
            assert!(!StorageVersionManager::needs_migration(&env, 1));
            assert!(!StorageVersionManager::needs_migration(&env, 0));
        });
    }

    #[test]
    fn test_versions_behind() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            assert_eq!(StorageVersionManager::versions_behind(&env, 5), 4);
            assert_eq!(StorageVersionManager::versions_behind(&env, 1), 0);
            assert_eq!(StorageVersionManager::versions_behind(&env, 0), 0);
        });
    }

    #[test]
    fn test_validate_upgrade() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            assert!(StorageVersionManager::validate_upgrade(&env, 2).is_ok());
            assert!(StorageVersionManager::validate_upgrade(&env, 3).is_err());
            assert!(StorageVersionManager::validate_upgrade(&env, 1).is_err());
            assert!(StorageVersionManager::validate_upgrade(&env, 0).is_err());
        });
    }

    #[test]
    fn test_validate_incremental_migration() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            assert!(StorageVersionManager::validate_incremental_migration(&env, 2).is_ok());
            assert!(StorageVersionManager::validate_incremental_migration(&env, 3).is_err());
            assert!(StorageVersionManager::validate_incremental_migration(&env, 1).is_err());
        });
    }

    #[test]
    fn test_get_version_info() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            let info = StorageVersionManager::get_version_info(&env);
            assert_eq!(info.version, 1);
            assert_eq!(info.label, String::from_str(&env, "unknown"));
        });
    }

    #[test]
    fn test_initialize_with_admin() {
        let env = Env::default();
        env.as(|| {
            let admin = soroban_sdk::Address::generate(&env);
            let label = String::from_str(&env, "v1.0.0");
            StorageVersionManager::initialize_with_admin(&env, 1, &admin, label.clone()).unwrap();

            assert_eq!(StorageVersionManager::get_version(&env), 1);
            assert_eq!(
                StorageVersionManager::get_migration_admin(&env),
                Some(admin)
            );
            let info = StorageVersionManager::get_version_info(&env);
            assert_eq!(info.label, label);
        });
    }

    #[test]
    fn test_migrate_to_with_label() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 1).unwrap();
            let label = String::from_str(&env, "v2.0.0");
            let result =
                StorageVersionManager::migrate_to_with_label(&env, 2, label.clone()).unwrap();
            assert!(result.migrated);
            assert_eq!(StorageVersionManager::get_version(&env), 2);
            let info = StorageVersionManager::get_version_info(&env);
            assert_eq!(info.label, label);
        });
    }

    #[test]
    fn test_get_migration_admin_none() {
        let env = Env::default();
        env.as(|| {
            assert_eq!(StorageVersionManager::get_migration_admin(&env), None);
        });
    }
}
