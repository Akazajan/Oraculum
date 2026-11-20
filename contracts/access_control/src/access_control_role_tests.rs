#[cfg(test)]
mod role_access_control_tests {
    use crate::access_control::AccessControlModule;
    use crate::errors::{role_from_str, role_from_u32, AccessControlError};
    use crate::types::{AccessControlConfig, UserRole};
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup_initialized_env() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::AccessControl, ());
        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        env.as_contract(&contract_id, || {
            AccessControlModule::initialize(&env, admin.clone(), None).unwrap();
        });
        (env, contract_id, admin, user1, user2)
    }

    /// Run `f` in its own contract frame.
    ///
    /// Each privileged call does a `require_auth`, and an address can only be
    /// authorized once per frame, so every operation gets a fresh frame, just
    /// as separate contract invocations would.
    fn call<T>(env: &Env, contract_id: &Address, f: impl FnOnce() -> T) -> T {
        env.as_contract(contract_id, f)
    }

    /// Admin should be able to perform all admin-only operations.
    #[test]
    fn test_admin_can_create_resource() {
        let (env, id, admin, user1, _) = setup_initialized_env();

        // Admin can set roles
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        });
        assert!(result.is_ok(), "Admin should be able to set roles");
        assert_eq!(
            call(&env, &id, || AccessControlModule::get_role(
                &env,
                user1.clone()
            )),
            UserRole::Member
        );

        // Admin can blacklist users
        let result = call(&env, &id, || {
            AccessControlModule::blacklist_user(&env, admin.clone(), user1.clone())
        });
        assert!(result.is_ok(), "Admin should be able to blacklist users");

        // Admin can pause/unpause
        let result = call(&env, &id, || {
            AccessControlModule::pause(&env, admin.clone())
        });
        assert!(result.is_ok(), "Admin should be able to pause the contract");
        assert!(call(&env, &id, || AccessControlModule::is_paused(&env)));

        let result = call(&env, &id, || {
            AccessControlModule::unpause(&env, admin.clone())
        });
        assert!(
            result.is_ok(),
            "Admin should be able to unpause the contract"
        );

        // Admin can update config
        let result = call(&env, &id, || {
            AccessControlModule::update_config(&env, admin.clone(), AccessControlConfig::default())
        });
        assert!(result.is_ok(), "Admin should be able to update config");

        // Admin can remove roles
        let result = call(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user1.clone())
        });
        assert!(result.is_ok(), "Admin should be able to remove roles");
    }

    /// Non-admin users should not be able to perform admin-only operations.
    /// Permission failures must produce clear, specific errors.
    #[test]
    fn test_user_cannot_create_resource() {
        let (env, id, admin, user1, user2) = setup_initialized_env();

        // Guest cannot set roles
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, user1.clone(), user2.clone(), UserRole::Member)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Non-admin should get AdminRequired error when setting roles"
        );

        // Guest cannot blacklist
        let result = call(&env, &id, || {
            AccessControlModule::blacklist_user(&env, user1.clone(), user2.clone())
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Non-admin should get AdminRequired error when blacklisting"
        );

        // Guest cannot pause
        let result = call(&env, &id, || {
            AccessControlModule::pause(&env, user1.clone())
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Non-admin should get AdminRequired error when pausing"
        );

        // Guest cannot remove roles
        let result = call(&env, &id, || {
            AccessControlModule::remove_role(&env, user1.clone(), user2.clone())
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Non-admin should get AdminRequired error when removing roles"
        );

        // Member also cannot perform admin operations
        call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        })
        .unwrap();

        let result = call(&env, &id, || {
            AccessControlModule::pause(&env, user1.clone())
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Members should not be able to pause"
        );

        // Member cannot set other users' roles
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, user1.clone(), user2.clone(), UserRole::Member)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Members should not be able to assign roles"
        );
    }

    /// Unauthorized access attempts must produce clear, specific error messages.
    #[test]
    fn test_unauthorized_access_denied() {
        let (env, id, admin, user1, _) = setup_initialized_env();

        // Blacklisted users should get Unauthorized error
        call(&env, &id, || {
            AccessControlModule::blacklist_user(&env, admin.clone(), user1.clone())
        })
        .unwrap();
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::Unauthorized,
            "Blacklisted user should get Unauthorized error"
        );

        // Insufficient role access should produce InsufficientRole error
        call(&env, &id, || {
            AccessControlModule::unblacklist_user(&env, admin.clone(), user1.clone())
        })
        .unwrap();
        let result = call(&env, &id, || {
            AccessControlModule::require_access(&env, user1.clone(), UserRole::Admin)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::InsufficientRole,
            "User without admin role should get InsufficientRole error"
        );

        // Operations on uninitialized system should produce NotInitialized error
        let env2 = Env::default();
        let contract_id2 = env2.register(crate::AccessControl, ());
        let result = env2.as_contract(&contract_id2, || {
            AccessControlModule::set_role(
                &env2,
                Address::generate(&env2),
                Address::generate(&env2),
                UserRole::Member,
            )
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::NotInitialized,
            "Uninitialized system should get NotInitialized error"
        );

        // Paused contract should produce ContractPaused error
        call(&env, &id, || {
            AccessControlModule::pause(&env, admin.clone())
        })
        .unwrap();
        let target = Address::generate(&env);
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), target.clone(), UserRole::Member)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::ContractPaused,
            "Paused contract should get ContractPaused error"
        );
    }

    /// Role escalation must be prevented (e.g., member can't promote themselves to admin).
    #[test]
    fn test_role_escalation_prevented() {
        let (env, id, admin, user1, user2) = setup_initialized_env();

        // Set user1 as Member
        call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        })
        .unwrap();
        assert_eq!(
            call(&env, &id, || AccessControlModule::get_role(
                &env,
                user1.clone()
            )),
            UserRole::Member
        );

        // Member cannot assign Admin role to anyone
        let other = Address::generate(&env);
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, user1.clone(), other.clone(), UserRole::Admin)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Members should not be able to assign Admin role"
        );

        // Member cannot promote themselves
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, user1.clone(), user1.clone(), UserRole::Admin)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Members should not be able to self-promote to Admin"
        );

        // Verify user1 is still Member after failed escalation attempts
        assert_eq!(
            call(&env, &id, || AccessControlModule::get_role(
                &env,
                user1.clone()
            )),
            UserRole::Member,
            "Target role should remain unchanged after failed escalation"
        );

        // Admin cannot remove the main admin's role
        let result = call(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), admin.clone())
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::RoleHierarchyViolation,
            "Admin cannot remove their own admin role"
        );

        // Old admin cannot re-assign roles after transfer
        call(&env, &id, || {
            AccessControlModule::propose_admin_transfer(&env, admin.clone(), user1.clone())
        })
        .unwrap();
        call(&env, &id, || {
            AccessControlModule::accept_admin_transfer(&env, user1.clone())
        })
        .unwrap();

        let target = Address::generate(&env);
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), target.clone(), UserRole::Member)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Former admin should no longer have admin privileges after transfer"
        );

        // Authorized escalation still succeeds: New admin (user1) can assign roles
        let result = call(&env, &id, || {
            AccessControlModule::set_role(&env, user1.clone(), user2.clone(), UserRole::Member)
        });
        assert!(
            result.is_ok(),
            "Authorized admin should be able to assign roles after transfer"
        );
        assert_eq!(
            call(&env, &id, || AccessControlModule::get_role(
                &env,
                user2.clone()
            )),
            UserRole::Member,
            "Target role should be updated after successful authorized escalation"
        );
    }

    /// Role hierarchy (Admin > Member > Guest) must be enforced for all access checks.
    #[test]
    fn test_permission_inheritance() {
        let (env, id, admin, user1, _) = setup_initialized_env();

        call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        })
        .unwrap();

        call(&env, &id, || {
            // Member inherits Guest permissions
            assert!(
                AccessControlModule::check_access(&env, user1.clone(), UserRole::Guest).unwrap(),
                "Member should inherit Guest access"
            );
            // Member has Member-level access
            assert!(
                AccessControlModule::check_access(&env, user1.clone(), UserRole::Member).unwrap(),
                "Member should have Member access"
            );
            // Member does NOT have Admin-level access
            assert!(
                !AccessControlModule::check_access(&env, user1.clone(), UserRole::Admin).unwrap(),
                "Member should not have Admin access"
            );
            // Admin inherits both Guest and Member
            assert!(
                AccessControlModule::check_access(&env, admin.clone(), UserRole::Guest).unwrap(),
                "Admin should inherit Guest access"
            );
            assert!(
                AccessControlModule::check_access(&env, admin.clone(), UserRole::Member).unwrap(),
                "Admin should inherit Member access"
            );
        });
    }

    /// C02 / issue #460: authorized admin removal clears the role; repeated removal is deterministic.
    #[test]
    fn test_remove_role_requires_admin_auth_binding() {
        let (env, id, admin, user1, _) = setup_initialized_env();

        call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        })
        .unwrap();

        let first = call(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user1.clone())
        });
        assert!(first.is_ok(), "authorized admin can remove role");
        assert_eq!(
            call(&env, &id, || AccessControlModule::get_role(
                &env,
                user1.clone()
            )),
            UserRole::Guest,
        );

        let second = call(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user1.clone())
        });
        assert!(second.is_ok(), "repeated removal stays deterministic");
        assert_eq!(
            call(&env, &id, || AccessControlModule::get_role(
                &env,
                user1.clone()
            )),
            UserRole::Guest,
        );

        let denied = call(&env, &id, || {
            AccessControlModule::remove_role(&env, user1.clone(), admin.clone())
        });
        assert_eq!(denied.unwrap_err(), AccessControlError::AdminRequired);
    }

    // ── C29 / issue #913: unknown roles return a consistent error ───────────

    /// Supported role discriminants map to their roles.
    #[test]
    fn test_role_from_u32_accepts_supported_values() {
        assert_eq!(role_from_u32(0), Ok(UserRole::Guest));
        assert_eq!(role_from_u32(1), Ok(UserRole::Member));
        assert_eq!(role_from_u32(2), Ok(UserRole::Admin));
    }

    /// Unsupported role discriminants are rejected with `UnknownRole` and
    /// never default to Guest.
    #[test]
    fn test_role_from_u32_rejects_unknown_values() {
        for value in [3u32, 4, 42, u32::MAX] {
            assert_eq!(
                role_from_u32(value),
                Err(AccessControlError::UnknownRole),
                "role value {} must be rejected",
                value
            );
        }
    }

    /// Role names parse case-insensitively.
    #[test]
    fn test_role_from_str_accepts_supported_names() {
        assert_eq!(role_from_str("guest"), Ok(UserRole::Guest));
        assert_eq!(role_from_str("Member"), Ok(UserRole::Member));
        assert_eq!(role_from_str("ADMIN"), Ok(UserRole::Admin));
    }

    /// Unsupported role names return `UnknownRole` rather than an implicit
    /// default role.
    #[test]
    fn test_role_from_str_rejects_unknown_names() {
        for name in ["", "owner", "superadmin", "guest ", "0"] {
            assert_eq!(
                role_from_str(name),
                Err(AccessControlError::UnknownRole),
                "role name {:?} must be rejected",
                name
            );
        }
    }

    /// The unknown-role error has a stable code and description, and every
    /// unsupported value yields the same error.
    #[test]
    fn test_unknown_role_error_is_consistent() {
        let err = AccessControlError::UnknownRole;
        assert_eq!(err as u32, 136);
        assert!(!err.description().is_empty());
        assert_ne!(err, AccessControlError::InvalidRole);
        assert!(!err.is_critical());
        assert!(!err.is_permission_error());
        assert_eq!(role_from_u32(7), role_from_u32(99));
        assert_eq!(role_from_u32(7), role_from_str("unknown"));
    }

    /// An unknown role cannot be used to grant access, and a rejected parse
    /// leaves the user's stored role unchanged.
    #[test]
    fn test_unknown_role_does_not_grant_implicit_role() {
        let (env, id, admin, user1, _) = setup_initialized_env();

        call(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        })
        .unwrap();

        let result = call(&env, &id, || {
            role_from_u32(9).and_then(|role| {
                AccessControlModule::set_role(&env, admin.clone(), user1.clone(), role)
            })
        });
        assert_eq!(result, Err(AccessControlError::UnknownRole));
        assert_eq!(
            call(&env, &id, || AccessControlModule::get_role(
                &env,
                user1.clone()
            )),
            UserRole::Member,
            "rejected role value must not change the stored role"
        );
    }
}
