#[cfg(test)]
mod role_access_control_tests {
    use crate::access_control::{AccessControlModule, DataKey};
    use crate::errors::AccessControlError;
    use crate::types::{AccessControlConfig, UserRole};
    use soroban_sdk::{
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal, Vec,
    };

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

    /// Run `f` in its own contract frame. Each successful admin action calls
    /// `require_auth` on the caller, and the host only allows that once per
    /// frame, so consecutive authorized actions need separate frames.
    fn ac<T>(env: &Env, contract_id: &Address, f: impl FnOnce() -> T) -> T {
        env.as_contract(contract_id, f)
    }

    fn role_of(env: &Env, contract_id: &Address, user: &Address) -> UserRole {
        ac(env, contract_id, || {
            AccessControlModule::get_role(env, user.clone())
        })
    }

    /// Admin should be able to perform all admin-only operations.
    #[test]
    fn test_admin_can_create_resource() {
        let (env, id, admin, user1, _) = setup_initialized_env();

        // Admin can set roles
        let result = ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        });
        assert!(result.is_ok(), "Admin should be able to set roles");
        assert_eq!(role_of(&env, &id, &user1), UserRole::Member);

        // Admin can blacklist users
        let result = ac(&env, &id, || {
            AccessControlModule::blacklist_user(&env, admin.clone(), user1.clone())
        });
        assert!(result.is_ok(), "Admin should be able to blacklist users");

        // Admin can pause/unpause
        let result = ac(&env, &id, || {
            AccessControlModule::pause(&env, admin.clone())
        });
        assert!(result.is_ok(), "Admin should be able to pause the contract");
        assert!(ac(&env, &id, || AccessControlModule::is_paused(&env)));

        let result = ac(&env, &id, || {
            AccessControlModule::unpause(&env, admin.clone())
        });
        assert!(
            result.is_ok(),
            "Admin should be able to unpause the contract"
        );

        // Admin can update config
        let result = ac(&env, &id, || {
            AccessControlModule::update_config(&env, admin.clone(), AccessControlConfig::default())
        });
        assert!(result.is_ok(), "Admin should be able to update config");

        // Admin can remove roles
        let result = ac(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user1.clone())
        });
        assert!(result.is_ok(), "Admin should be able to remove roles");
    }

    /// Non-admin users should not be able to perform admin-only operations.
    /// Permission failures must produce clear, specific errors.
    #[test]
    fn test_user_cannot_create_resource() {
        let (env, id, admin, user1, user2) = setup_initialized_env();

        ac(&env, &id, || {
            // Guest cannot set roles
            let result =
                AccessControlModule::set_role(&env, user1.clone(), user2.clone(), UserRole::Member);
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
        });

        // Member also cannot perform admin operations
        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
                .unwrap()
        });

        ac(&env, &id, || {
            let result = AccessControlModule::pause(&env, user1.clone());
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Members should not be able to pause"
            );

            // Member cannot set other users' roles
            let result =
                AccessControlModule::set_role(&env, user1.clone(), user2.clone(), UserRole::Member);
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
        let (env, id, admin, user1, _) = setup_initialized_env();

        // Blacklisted users should get Unauthorized error
        ac(&env, &id, || {
            AccessControlModule::blacklist_user(&env, admin.clone(), user1.clone()).unwrap()
        });
        let result = ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::Unauthorized,
            "Blacklisted user should get Unauthorized error"
        );

        // Insufficient role access should produce InsufficientRole error
        ac(&env, &id, || {
            AccessControlModule::unblacklist_user(&env, admin.clone(), user1.clone()).unwrap()
        });
        let result = ac(&env, &id, || {
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
        ac(&env, &id, || {
            AccessControlModule::pause(&env, admin.clone()).unwrap()
        });
        let result = ac(&env, &id, || {
            AccessControlModule::set_role(
                &env,
                admin.clone(),
                Address::generate(&env),
                UserRole::Member,
            )
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
        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
                .unwrap()
        });
        assert_eq!(role_of(&env, &id, &user1), UserRole::Member);

        ac(&env, &id, || {
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
            let result =
                AccessControlModule::set_role(&env, user1.clone(), user1.clone(), UserRole::Admin);
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::AdminRequired,
                "Members should not be able to self-promote to Admin"
            );
        });

        // Verify user1 is still Member after failed escalation attempts
        assert_eq!(
            role_of(&env, &id, &user1),
            UserRole::Member,
            "Target role should remain unchanged after failed escalation"
        );

        // Admin cannot remove the main admin's role
        let result = ac(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), admin.clone())
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::RoleHierarchyViolation,
            "Admin cannot remove their own admin role"
        );

        // Old admin cannot re-assign roles after transfer
        ac(&env, &id, || {
            AccessControlModule::propose_admin_transfer(&env, admin.clone(), user1.clone()).unwrap()
        });
        ac(&env, &id, || {
            AccessControlModule::accept_admin_transfer(&env, user1.clone()).unwrap()
        });

        let result = ac(&env, &id, || {
            AccessControlModule::set_role(
                &env,
                admin.clone(),
                Address::generate(&env),
                UserRole::Member,
            )
        });
        assert_eq!(
            result.unwrap_err(),
            AccessControlError::AdminRequired,
            "Former admin should no longer have admin privileges after transfer"
        );

        // Authorized escalation still succeeds: New admin (user1) can assign roles
        let result = ac(&env, &id, || {
            AccessControlModule::set_role(&env, user1.clone(), user2.clone(), UserRole::Member)
        });
        assert!(
            result.is_ok(),
            "Authorized admin should be able to assign roles after transfer"
        );
        assert_eq!(
            role_of(&env, &id, &user2),
            UserRole::Member,
            "Target role should be updated after successful authorized escalation"
        );
    }

    /// Role hierarchy (Admin > Member > Guest) must be enforced for all access checks.
    #[test]
    fn test_permission_inheritance() {
        let (env, id, admin, user1, _) = setup_initialized_env();

        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
                .unwrap()
        });

        ac(&env, &id, || {
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

        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user1.clone(), UserRole::Member)
                .unwrap()
        });

        let first = ac(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user1.clone())
        });
        assert!(first.is_ok(), "authorized admin can remove role");
        assert_eq!(role_of(&env, &id, &user1), UserRole::Guest);

        let second = ac(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user1.clone())
        });
        assert!(second.is_ok(), "repeated removal stays deterministic");
        assert_eq!(role_of(&env, &id, &user1), UserRole::Guest);

        let denied = ac(&env, &id, || {
            AccessControlModule::remove_role(&env, user1.clone(), admin.clone())
        });
        assert_eq!(denied.unwrap_err(), AccessControlError::AdminRequired);
    }

    /// C30 / #914: require_admin re-reads the caller's current role from storage.
    #[test]
    fn test_c30_require_admin_reads_current_role() {
        let (env, id, admin, user, other) = setup_initialized_env();

        assert!(ac(&env, &id, || AccessControlModule::require_admin(
            &env, &admin
        ))
        .is_ok());
        assert_eq!(
            ac(&env, &id, || AccessControlModule::require_admin(
                &env, &user
            ))
            .unwrap_err(),
            AccessControlError::AdminRequired
        );

        // Promote other to Admin, then demote original admin via the new admin.
        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), other.clone(), UserRole::Admin)
                .unwrap()
        });
        ac(&env, &id, || {
            AccessControlModule::set_role(&env, other.clone(), admin.clone(), UserRole::Member)
                .unwrap()
        });
        assert_eq!(role_of(&env, &id, &admin), UserRole::Member);
        assert_eq!(
            ac(&env, &id, || AccessControlModule::require_admin(
                &env, &admin
            ))
            .unwrap_err(),
            AccessControlError::AdminRequired
        );
    }

    /// C30: check_access reflects live role changes with no cached membership.
    #[test]
    fn test_c30_check_access_uses_live_role_not_stale_claim() {
        let (env, id, admin, user, _) = setup_initialized_env();

        assert!(!ac(&env, &id, || {
            AccessControlModule::check_access(&env, user.clone(), UserRole::Member).unwrap()
        }));

        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user.clone(), UserRole::Member)
                .unwrap()
        });
        assert!(ac(&env, &id, || {
            AccessControlModule::check_access(&env, user.clone(), UserRole::Member).unwrap()
        }));

        ac(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user.clone()).unwrap()
        });
        assert!(!ac(&env, &id, || {
            AccessControlModule::check_access(&env, user.clone(), UserRole::Member).unwrap()
        }));
    }

    // ── #905 / C21: unauthorized role changes ────────────────────────────────

    fn setup_multisig_env() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::AccessControl, ());
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let user = Address::generate(&env);
        env.as_contract(&contract_id, || {
            let admins = Vec::from_array(&env, [admin1.clone(), admin2.clone()]);
            AccessControlModule::initialize_multisig(&env, admins, 2, None).unwrap();
        });
        (env, contract_id, admin1, admin2, user)
    }

    /// A non-admin caller is rejected before the target is inspected, so the
    /// result is the same permission error whatever the target's state is,
    /// and no role is written.
    #[test]
    fn test_c21_non_admin_rejected_before_target_checks() {
        let (env, id, admin, user1, user2) = setup_initialized_env();
        ac(&env, &id, || {
            AccessControlModule::blacklist_user(&env, admin.clone(), user2.clone()).unwrap()
        });

        ac(&env, &id, || {
            for role in [UserRole::Guest, UserRole::Member, UserRole::Admin] {
                assert_eq!(
                    AccessControlModule::set_role(&env, user1.clone(), user2.clone(), role)
                        .unwrap_err(),
                    AccessControlError::AdminRequired
                );
            }
            assert_eq!(
                AccessControlModule::remove_role(&env, user1.clone(), user2.clone()).unwrap_err(),
                AccessControlError::AdminRequired
            );
            assert!(!env
                .storage()
                .persistent()
                .has(&DataKey::UserRole(user2.clone())));
        });
    }

    /// Role changes must be signed by the administrator: without the admin's
    /// authorization the host rejects the call and nothing is written.
    #[test]
    fn test_c21_role_grant_requires_admin_signature() {
        let (env, id, admin, user1, _) = setup_initialized_env();
        let client = crate::AccessControlClient::new(&env, &id);

        // Only the target user signs — not the admin named as caller.
        env.set_auths(&[]);
        let result = client
            .mock_auths(&[MockAuth {
                address: &user1,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "set_role",
                    args: (admin.clone(), user1.clone(), UserRole::Admin).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_set_role(&admin, &user1, &UserRole::Admin);
        assert!(result.is_err());
        assert_eq!(client.get_role(&user1), UserRole::Guest);

        let result = client
            .mock_auths(&[MockAuth {
                address: &user1,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "remove_role",
                    args: (admin.clone(), user1.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_remove_role(&admin, &user1);
        assert!(result.is_err());

        // With the admin's signature the same grant succeeds.
        client
            .mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "set_role",
                    args: (admin.clone(), user1.clone(), UserRole::Member).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .set_role(&admin, &user1, &UserRole::Member);
        assert_eq!(client.get_role(&user1), UserRole::Member);
    }

    /// A blacklisted administrator can no longer grant or revoke roles.
    #[test]
    fn test_c21_blacklisted_admin_cannot_change_roles() {
        let (env, id, admin, second_admin, user) = setup_initialized_env();
        ac(&env, &id, || {
            AccessControlModule::set_role(
                &env,
                admin.clone(),
                second_admin.clone(),
                UserRole::Admin,
            )
            .unwrap()
        });
        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user.clone(), UserRole::Member)
                .unwrap()
        });
        ac(&env, &id, || {
            AccessControlModule::blacklist_user(&env, admin.clone(), second_admin.clone()).unwrap()
        });

        ac(&env, &id, || {
            assert_eq!(
                AccessControlModule::set_role(
                    &env,
                    second_admin.clone(),
                    user.clone(),
                    UserRole::Admin
                )
                .unwrap_err(),
                AccessControlError::UserBlacklisted
            );
        });
        ac(&env, &id, || {
            assert_eq!(
                AccessControlModule::remove_role(&env, second_admin.clone(), user.clone())
                    .unwrap_err(),
                AccessControlError::UserBlacklisted
            );
        });
        assert_eq!(role_of(&env, &id, &user), UserRole::Member);
    }

    /// Revocations honour the pause switch just like grants do.
    #[test]
    fn test_c21_remove_role_blocked_while_paused() {
        let (env, id, admin, user, _) = setup_initialized_env();
        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin.clone(), user.clone(), UserRole::Member)
                .unwrap()
        });
        ac(&env, &id, || {
            AccessControlModule::pause(&env, admin.clone()).unwrap()
        });

        let result = ac(&env, &id, || {
            AccessControlModule::remove_role(&env, admin.clone(), user.clone())
        });
        assert_eq!(result.unwrap_err(), AccessControlError::ContractPaused);
        assert_eq!(role_of(&env, &id, &user), UserRole::Member);
    }

    /// An administrator cannot demote themselves through `set_role`
    /// (the same guard `remove_role` already enforces).
    #[test]
    fn test_c21_admin_cannot_self_demote_via_set_role() {
        let (env, id, admin, _, _) = setup_initialized_env();
        for role in [UserRole::Member, UserRole::Guest] {
            let result = ac(&env, &id, || {
                AccessControlModule::set_role(&env, admin.clone(), admin.clone(), role)
            });
            assert_eq!(
                result.unwrap_err(),
                AccessControlError::RoleHierarchyViolation
            );
        }
        assert_eq!(role_of(&env, &id, &admin), UserRole::Admin);
    }

    /// In multisig mode a single signer cannot mint new admins or strip a
    /// co-signer's role directly — that must go through a proposal.
    #[test]
    fn test_c21_multisig_signer_cannot_bypass_quorum() {
        let (env, id, admin1, admin2, user) = setup_multisig_env();

        // Each attempt runs in its own frame: the signer's authorization is
        // checked (and consumed) before the quorum guard rejects the change.
        let grant_admin = ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin1.clone(), user.clone(), UserRole::Admin)
        });
        assert_eq!(
            grant_admin.unwrap_err(),
            AccessControlError::RoleHierarchyViolation
        );
        let demote_cosigner = ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin1.clone(), admin2.clone(), UserRole::Guest)
        });
        assert_eq!(
            demote_cosigner.unwrap_err(),
            AccessControlError::RoleHierarchyViolation
        );
        let revoke_cosigner = ac(&env, &id, || {
            AccessControlModule::remove_role(&env, admin1.clone(), admin2.clone())
        });
        assert_eq!(
            revoke_cosigner.unwrap_err(),
            AccessControlError::RoleHierarchyViolation
        );
        assert_eq!(role_of(&env, &id, &user), UserRole::Guest);
        assert_eq!(role_of(&env, &id, &admin2), UserRole::Admin);
        assert!(!ac(&env, &id, || AccessControlModule::is_admin(
            &env,
            user.clone()
        )));

        // Non-admin roles can still be managed directly by a signer.
        ac(&env, &id, || {
            AccessControlModule::set_role(&env, admin1.clone(), user.clone(), UserRole::Member)
                .unwrap()
        });
        assert_eq!(role_of(&env, &id, &user), UserRole::Member);
    }
}
