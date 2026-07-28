//! # Storage Versioning for Contract Upgrades
//!
//! Provides a `StorageVersion` struct and migration helpers that allow
//! Oraculum contracts to track their storage schema version. This enables
//! safe, incremental upgrades: each new contract version bumps the storage
//! version and can run migration logic to transform existing data.
//!
//! ## Usage
//!
//! ```rust,ignore
//! use common_types::storage_version::{StorageVersion, StorageVersionManager};
//!
//! // At contract initialization:
//! StorageVersionManager::initialize(&env, 1);
//!
//! // Before running upgrade logic:
//! let current = StorageVersionManager::get_version(&env);
//! if current < 2 {
//!     StorageVersionManager::migrate_to(&env, 2)?;
//! }
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

    /// Perform a migration to the target version.
    ///
    /// This function updates the stored version number and records the
    /// migration timestamp. It does NOT execute any data migration logic —
    /// callers should handle data transformation between `get_version()`
    /// and the target version before calling this method.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `target_version` - The version to migrate to
    ///
    /// # Returns
    /// * `Ok(MigrationResult)` with migration details
    /// * `Err(())` if the target version is not greater than the current version
    pub fn migrate_to(env: &Env, target_version: u32) -> Result<MigrationResult, ()> {
        let current_version = Self::get_version(env);

        if target_version <= current_version {
            return Err(());
        }

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

        Ok(MigrationResult {
            from_version: current_version,
            to_version: target_version,
            migrated: true,
            completed_at: timestamp,
        })
    }

    /// Perform a migration with a new version label.
    ///
    /// Combines `migrate_to` with updating the human-readable label.
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
        let result = Self::migrate_to(env, target_version)?;
        env.storage()
            .instance()
            .set(&VersionStorageKey::VersionLabel, &label);
        Ok(result)
    }

    /// Attempt a migration only if the contract needs it.
    ///
    /// If the contract is already at or beyond the target version, returns
    /// a `MigrationResult` with `migrated: false` instead of failing.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `target_version` - The version to migrate to
    pub fn try_migrate(env: &Env, target_version: u32) -> MigrationResult {
        let current_version = Self::get_version(env);

        if current_version >= target_version {
            let timestamp = env.ledger().timestamp();
            return MigrationResult {
                from_version: current_version,
                to_version: current_version,
                migrated: false,
                completed_at: timestamp,
            };
        }

        Self::migrate_to(env, target_version).unwrap_or_else(|_| {
            let timestamp = env.ledger().timestamp();
            MigrationResult {
                from_version: current_version,
                to_version: current_version,
                migrated: false,
                completed_at: timestamp,
            }
        })
    }

    /// Validate that a target version is reachable from the current version.
    ///
    /// Returns `Ok(())` if the target version is exactly one greater than the
    /// current version (incremental migration), or `Err(())` if the gap is
    /// larger (multi-step migration required).
    pub fn validate_incremental_migration(env: &Env, target_version: u32) -> Result<(), ()> {
        let current = Self::get_version(env);
        if target_version == current + 1 {
            Ok(())
        } else {
            Err(())
        }
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
    fn test_migrate_to_fails_if_target_not_greater() {
        let env = Env::default();
        env.as(|| {
            StorageVersionManager::initialize(&env, 2).unwrap();
            assert!(StorageVersionManager::migrate_to(&env, 2).is_err());
            assert!(StorageVersionManager::migrate_to(&env, 1).is_err());
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
            let result = StorageVersionManager::try_migrate(&env, 5);
            assert!(result.migrated);
            assert_eq!(result.from_version, 1);
            assert_eq!(result.to_version, 5);
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
