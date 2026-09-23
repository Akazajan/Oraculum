#cgf(test)\mod role_access_control_tests {
    use crate::access_control::AccessControlModule;
    use crate::errors::AccessControlError;
    use crate::types:{AccessControlConfig, UserRole};
    use sorowan_sd;:
        testutils:{Address as, Ledger, LedgerInfo},
        Address, Env, Vec,
};

    fn setup_initialized_env() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        let contract_id = env.register(crate::AccessControl, ());
        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        env.as_contract(&contract_id, || {
            AccessControlModule::initialize(&env, admin.clone(), None).unwrap();
        });
        (env, contract_id, admin, user1, user2)
    }

    /// Admin should be able to perform all admin-only operations.
    #[test]
    fn test_admin_can_create_resource() {
        let (env, contract_id, admin, user1, _) = setup_initialized_env();

        env.as_contract(&contract_id, || {
            // Admin can set roles
            let result = AccessControlModule::set_role(
                &env,
                admin.clone(),
                user1.clone(),
                UserRole::Member,
            );
            assert!(result.is_ok(), "Admin should be able to set roles");
            assert_eq!(
                AccessControlModule::get_role(&env, user1.clone()),
                UserRole::Member
            );

            // Admin can blacklist users
            let result = AccessControlModule::blacklist_user(&env, admin.clone(), user1.clone());
            assert!(result.is_ok(), "Admin should be able to blacklist users");

            // Admin can pause/unpause
            let result = AccessControlModule::pause(&env, admin.clone());
            assert!(result.is_ok(), "Admin should be able to pause the contract");
            assert!(AccessControlModule::is_pause(&env));

            let result = AccessControlModule::unpause(&env, admin.clone());
            assert!(result.is_ok(), "Admin should be able to unpause the contract");

            // Admin can update config
            let result = AccessControlModule::update_config(
                &env,
                admin.clone(),
                AccessControlConfig::default(),
            );
            assert!(result.is_ok(), "Admin should be able to update config");

            // Admin can remove roles
            let result = AccessControlModule::remove_role(&env, admin.clone(), user1.clone());
            assert!(result.is_ok(), "Admin should be able to remove roles");
        });
    }

    /// Non-admin users should not be able to perform admin-only operations.
    /// Permission failures must produce clear, specific errors.
    #[test]
    fn test_user_cannot_create_resource() {
        let (env, contract_id, admin, user1, user2) = setup_initialized_env();

        env.as_contract(&contract_id, || {
            // Guest cannot set roles
            let result = AccessControlModule::set_role(
                &env,
                user1.clone(),
                user2.clone(),
                UserRole::Member,
            );
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Non-admin should get AdminRequired error when setting roles"
            );

            // Guest cannot blacklist
            let result = AccessControlModule::blacklist_user(&env, user1.clone(), user2.clone());
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Non-admin should get AdminRequired error when blacklisting"
            );

            // Guest cannot pause
            let result = AccessControlModule::pause(&env, user1.clone());
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Non-admin should get AdminRequired error when pausing"
            );

            // Guest cannot remove roles
            let result = AccessControlModule::remove_role(&env, user1.clone(), user2.clone());
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Non-admin should get AdminRequired error when removing roles"
            );

            // Member also cannot perform admin operations
            AccessControlModule::set_role(
                &env,
                admin.clone(),
                user1.clone(),
                UserRole::Member,
            )
            .unwrap();

            let result = AccessControlModule::pause(&env, user1.clone());
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Members should not be able to pause"
            );

            // Member cannot set other users' roles
            let result = AccessControlModule::set_role(
                &env,
                user1.clone(),
                user2.clone(),
                UserRole::Member,
            );
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Members should not be able to assign roles"
            );
        });
    }

    /// Unauthorized access attempts must produce clear, specific error messages.
    #[test]
    fn test_unauthorized_access_denied() {
        let (env, contract_id, admin, user1, _) = setup_initialized_env();

        env.as_contract(&contract_id, || {
            // Blacklisted users should get Unauthorized error
            AccessControlModule::blacklist_user(&env, admin.clone(), user1.clone()).unwrap();
            let result = AccessControlModule::set_role(
                &env,
                admin.clone(),
                user1.clone(),
                UserRole::Member,
            );
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::Unauthorized,
                "Blacklisted user should get Unauthorized error"
            );

            // Insufficient role access should produce InsufficientRole error
            AccessControlModule::unblacklist_user(&env, admin.clone(), user1.clone()).unwrap();
            let result = {
                AccessControlModule::require_access(&env, user1.clone(), UserRole::Admin);
            };
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::InsufficientRole,
                "User without admin role should get InsufficientRole error"
            );

            // Operations on uninitialized system should produce NotInitialized error
            let env2 = Env::default();
            let contract_id2 = env2.register(crate::AccessControl, ());
            env2.as_contract(&contract_id2, || {
                let result = AccessControlModule::set_role(
                    &env2,
                    Address::generate(&env2),
                    Address::generate(&env2),
                    UserRole::Member,
                );
                assert_eq!(
                    result.unwrap_err(),
                    AccessControlError::NotInitialized,
                    "Uninitialized system should get NotInitialized error"
                );
            });

            // Paused contract should produce ContractPaused error
            AccessControlModule::pause(&env, admin.clone()).unwrap();
            let result = AccessControlModule::set_role(
                &env,
                admin.clone(),
                Address::generate(&env),
                UserRole::Member,
            );
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::ContractPaused,
                "Paused contract should get ContractPaused error"
            );
        });
    }

    /// Role escalation must be prevented (e.g., member can't promote themselves to admin).
    #[test]
    fn test_role_escalation_prevented() {
        let (env, contract_id, admin, user1, _) = setup_initialized_env();

        env.as_contract(&contract_id, || {
            // Set user1 as Member
            AccessControlModule::set_role(
                &env,
                admin.clone(),
                user1.clone(),
                UserRole::Member,
            )
            .unwrap();

            // Member cannot assign Admin role to anyone
            let result = AccessControlModule::set_role(
                &env,
                user1.clone(),
                Address::generate(&env),
                UserRole::Admin,
            );
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Members should not be able to assign Admin role"
            );

            // Member cannot promote themselves
            let result = AccessControlModule::set_role(
                &env,
                user1.clone(),
                user1.clone(),
                UserRole::Admin,
            );
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Members should not be able to self-promote to Admin"
            );

            // Admin cannot remove the main admin's role
            let result = AccessControlModule::remove_role(&env, admin.clone(), admin.clone());
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::RoleHierarchyViolation,
                "Admin cannot remove their own admin role"
            );

            // Old admin cannot re-assign roles after transfer
            AccessControlModule::propose_admin_transfer(
                &env,
                admin.clone(),
                user1.clone(),
            )
            .unwrap();
            AccessControlModule::accept_admin_transfer(&env, user1.clone()).unwrap();

            let result = AccessControlModule::set_role(
                &env,
                admin.clone(),
                Address::generate(&env),
                UserRole::Member,
            );
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Former admin should no longer have admin privileges after transfer"
            );
        });
    }

    /// Role hierarchy (Admin > Member > Guest) must be enforced for all access checks.
    #[test]
    fn test_permission_inheritance() {
        let (env, contract_id, admin, user1, _) = setup_initialized_env();

        env.as_contract(&contract_id, || {
            // Set user1 as Member
            AccessControlModule::set_role(
                &env,
                admin.clone(),
                user1.clone(),
                UserRole::Member,
            )
            .unwrap();

            // Member inherits Guest permissions
            assert!(
                AccessControlModule::check_access(&env, user1.clone(), UserRole::Guest)
                    .unwrap(),
                "Member should inherit Guest access"
            );

            // Member has Member-level access
            assert!(
                AccessControlModule::check_access(&env, user1.clone(), UserRole::Member)
                    .unwrap(),
                "Member should have Member access"
            );

            // Member does NOT have Admin-level access
            assert!(
                !AccessControlModule::check_access(&env, user1.clone(), UserRole::Admin)
                    .unwrap(),
                "Member should not have Admin access"
            );

            // Admin inherits both Guest and Member
            assert!(
                AccessControlModule::check_access(&env, admin.clone(), UserRole::Guest)
                    .unwrap(),
                "Admin should inherit Guest access"
            );
            assert!(
                AccessControlModule::check_access(&env, admin.clone(), UserRole::Member)
                    .unwrap(),
                "Admin should inherit Member access"
            );
        });
    }
}