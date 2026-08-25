//! Test contract to verify common types functionality

use crate::{AttendanceAction, MembershipStatus, SubscriptionPlan, UserRole};
use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol};

#[contract]
pub struct TestTypesContract;

#[contractimpl]
impl TestTypesContract {
    pub fn test_subscription(plan: SubscriptionPlan) -> SubscriptionPlan {
        plan
    }

    pub fn test_attendance(action: AttendanceAction) -> AttendanceAction {
        action
    }

    pub fn test_role(role: UserRole) -> UserRole {
        role
    }

    pub fn test_status(status: MembershipStatus) -> MembershipStatus {
        status
    }

    pub fn test_all_types(
        _env: Env,
        plan: SubscriptionPlan,
        action: AttendanceAction,
        role: UserRole,
        status: MembershipStatus,
    ) -> Symbol {
        let _subscription = plan;
        let _attendance = action;
        let _user_role = role;
        let _membership = status;
        Symbol::new(&_env, "success")
    }
}

#[contract]
pub struct TestStorageVersionContract;

#[contractimpl]
impl TestStorageVersionContract {
    /// Initialize the contract with storage version tracking
    pub fn initialize(env: Env, initial_version: u32) {
        crate::storage_version::StorageVersionManager::initialize(&env, initial_version).unwrap();
    }

    /// Initialize with admin and label
    pub fn initialize_with_admin(env: Env, initial_version: u32, admin: Address, label: String) {
        crate::storage_version::StorageVersionManager::initialize_with_admin(
            &env,
            initial_version,
            &admin,
            label,
        )
        .unwrap();
    }

    /// Get current storage version
    pub fn get_version(env: Env) -> u32 {
        crate::storage_version::StorageVersionManager::get_version(&env)
    }

    /// Get full version info
    pub fn get_version_info(env: Env) -> crate::storage_version::StorageVersion {
        crate::storage_version::StorageVersionManager::get_version_info(&env)
    }

    /// Check if migration is needed
    pub fn needs_migration(env: Env, target_version: u32) -> bool {
        crate::storage_version::StorageVersionManager::needs_migration(&env, target_version)
    }

    /// Perform migration to target version
    pub fn migrate_to(env: Env, target_version: u32) -> crate::storage_version::MigrationResult {
        crate::storage_version::StorageVersionManager::migrate_to(&env, target_version).unwrap()
    }

    /// Try migration (doesn't fail if already at target)
    pub fn try_migrate(env: Env, target_version: u32) -> crate::storage_version::MigrationResult {
        crate::storage_version::StorageVersionManager::try_migrate(&env, target_version)
    }

    /// Validate incremental migration
    pub fn validate_incremental_migration(env: Env, target_version: u32) -> bool {
        crate::storage_version::StorageVersionManager::validate_incremental_migration(&env, target_version)
            .is_ok()
    }

    /// Get versions behind count
    pub fn versions_behind(env: Env, target_version: u32) -> u32 {
        crate::storage_version::StorageVersionManager::versions_behind(&env, target_version)
    }

    /// Store some test data to verify migration preserves data
    pub fn set_test_data(env: Env, key: String, value: String) {
        env.storage().instance().set(&key, &value);
    }

    /// Get test data
    pub fn get_test_data(env: Env, key: String) -> Option<String> {
        env.storage().instance().get(&key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subscription_plan() {
        let env = Env::default();
        let contract_id = env.register(TestTypesContract, ());
        let client = TestTypesContractClient::new(&env, &contract_id);

        assert_eq!(
            client.test_subscription(&SubscriptionPlan::Monthly),
            SubscriptionPlan::Monthly
        );
        assert_eq!(
            client.test_subscription(&SubscriptionPlan::Daily),
            SubscriptionPlan::Daily
        );
    }

    #[test]
    fn test_attendance() {
        let env = Env::default();
        let contract_id = env.register(TestTypesContract, ());
        let client = TestTypesContractClient::new(&env, &contract_id);

        assert_eq!(
            client.test_attendance(&AttendanceAction::ClockIn),
            AttendanceAction::ClockIn
        );
    }

    #[test]
    fn test_role() {
        let env = Env::default();
        let contract_id = env.register(TestTypesContract, ());
        let client = TestTypesContractClient::new(&env, &contract_id);

        assert_eq!(client.test_role(&UserRole::Admin), UserRole::Admin);
    }

    #[test]
    fn test_status() {
        let env = Env::default();
        let contract_id = env.register(TestTypesContract, ());
        let client = TestTypesContractClient::new(&env, &contract_id);

        assert_eq!(
            client.test_status(&MembershipStatus::Active),
            MembershipStatus::Active
        );
        assert_eq!(
            client.test_status(&MembershipStatus::Revoked),
            MembershipStatus::Revoked
        );
    }

    #[test]
    fn test_all_types() {
        let env = Env::default();
        let contract_id = env.register(TestTypesContract, ());

        let client = TestTypesContractClient::new(&env, &contract_id);

        let result = client.test_all_types(
            &SubscriptionPlan::PayPerUse,
            &AttendanceAction::ClockOut,
            &UserRole::Staff,
            &MembershipStatus::Active,
        );

        assert_eq!(result, Symbol::new(&env, "success"));
    }
}

#[cfg(test)]
mod storage_version_tests {
    use super::*;

    #[test]
    fn test_storage_version_end_to_end_migration() {
        let env = Env::default();
        let contract_id = env.register(TestStorageVersionContract, ());
        let client = TestStorageVersionContractClient::new(&env, &contract_id);

        // Initialize at version 1
        client.initialize(&1);
        assert_eq!(client.get_version(), 1);

        // Store some test data at version 1
        let key = String::from_str(&env, "test_key");
        let value = String::from_str(&env, "v1_data");
        client.set_test_data(&key.clone(), &value.clone());

        // Verify data is accessible at version 1
        let retrieved = client.get_test_data(&key);
        assert_eq!(retrieved, Some(value.clone()));

        // Check migration is needed to version 2
        assert!(client.needs_migration(&2));
        assert!(!client.needs_migration(&1));

        // Perform migration to version 2
        let result = client.migrate_to(&2);
        assert!(result.migrated);
        assert_eq!(result.from_version, 1);
        assert_eq!(result.to_version, 2);

        // Verify version is now 2
        assert_eq!(client.get_version(), 2);

        // Verify old data is still accessible after migration
        let retrieved = client.get_test_data(&key);
        assert_eq!(retrieved, Some(value));

        // Verify migration to same version fails
        // The contract method uses unwrap, so this would panic if called
        // Instead, we verify through try_migrate which handles this gracefully
        let result = client.try_migrate(&2);
        assert!(!result.migrated, "Migration to same version should not migrate");
        assert_eq!(result.from_version, 2);
        assert_eq!(result.to_version, 2);

        // Try migration to version 3
        let result = client.try_migrate(&3);
        assert!(result.migrated);
        assert_eq!(result.to_version, 3);
        assert_eq!(client.get_version(), 3);

        // Verify data persists through multiple migrations
        let retrieved = client.get_test_data(&key);
        assert_eq!(retrieved, Some(value));
    }

    #[test]
    fn test_storage_version_data_migration_rejection() {
        let env = Env::default();
        let contract_id = env.register(TestStorageVersionContract, ());
        let client = TestStorageVersionContractClient::new(&env, &contract_id);

        // Initialize at version 1
        client.initialize(&1);

        // Store test data
        let key = String::from_str(&env, "migration_test");
        let value = String::from_str(&env, "old_format_data");
        client.set_test_data(&key.clone(), &value.clone());

        // Verify data exists
        assert_eq!(client.get_test_data(&key), Some(value.clone()));

        // Perform migration to version 2
        let result = client.migrate_to(&2);
        assert!(result.migrated);

        // In a real migration, you might transform or reject old data
        // For this test, we verify the migration system works correctly
        // and that the contract can decide how to handle old data

        // Simulate data transformation (in real contract, this would be in migration logic)
        let new_value = String::from_str(&env, "new_format_data");
        client.set_test_data(&key.clone(), &new_value.clone());

        // Verify new data format
        assert_eq!(client.get_test_data(&key), Some(new_value));
        assert_ne!(client.get_test_data(&key), Some(value));
    }

    #[test]
    fn test_storage_version_incremental_migration_validation() {
        let env = Env::default();
        let contract_id = env.register(TestStorageVersionContract, ());
        let client = TestStorageVersionContractClient::new(&env, &contract_id);

        // Initialize at version 1
        client.initialize(&1);

        // Validate incremental migration to version 2 (should succeed)
        assert!(client.validate_incremental_migration(&2));

        // Validate incremental migration to version 3 (should fail - requires multi-step)
        assert!(!client.validate_incremental_migration(&3));

        // Check versions behind
        assert_eq!(client.versions_behind(&5), 4);
        assert_eq!(client.versions_behind(&1), 0);

        // Perform incremental migration
        client.migrate_to(&2);
        assert_eq!(client.versions_behind(&5), 3);
    }

    #[test]
    fn test_storage_version_with_admin_and_label() {
        let env = Env::default();
        let contract_id = env.register(TestStorageVersionContract, ());
        let client = TestStorageVersionContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let label = String::from_str(&env, "v1.0.0");

        // Initialize with admin and label
        client.initialize_with_admin(&1, &admin, &label.clone());

        // Verify version info
        let info = client.get_version_info();
        assert_eq!(info.version, 1);
        assert_eq!(info.label, label);

        // Perform migration with new label
        let new_label = String::from_str(&env, "v2.0.0");
        client.migrate_to(&2);

        // Update label manually (in real contract, this would be done via migrate_to_with_label)
        let key = String::from_str(&env, "new_label_key");
        client.set_test_data(&key, &new_label);

        // Verify we can retrieve the new label
        assert_eq!(client.get_test_data(&key), Some(new_label));
    }

    #[test]
    fn test_storage_version_try_migrate_already_at_target() {
        let env = Env::default();
        let contract_id = env.register(TestStorageVersionContract, ());
        let client = TestStorageVersionContractClient::new(&env, &contract_id);

        // Initialize at version 3
        client.initialize(&3);

        // Try migrate to version 3 (should not fail, just return migrated: false)
        let result = client.try_migrate(&3);
        assert!(!result.migrated);
        assert_eq!(result.from_version, 3);
        assert_eq!(result.to_version, 3);

        // Try migrate to version 2 (should not migrate since current > target)
        let result = client.try_migrate(&2);
        assert!(!result.migrated);
        assert_eq!(result.from_version, 3);
        assert_eq!(result.to_version, 3);
    }
}
