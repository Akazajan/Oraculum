//! # Multi-Signature Guards for Manage Hub
//!
//! Provides reusable guard functions that enforce multi-signature approval
//! for critical admin operations in the manage_hub contract.
//!
//! These guards integrate with the `access_control` contract's multisig
//! infrastructure (`MultiSigConfig`, `ProposalAction`, `PendingProposal`)
//! to ensure that sensitive operations require the configured number of
//! admin approvals before execution.
//!
//! ## Usage
//!
//! ```rust,ignore
//! // Check if an operation requires multisig approval:
//! MultisigGuard::operation_requires_multisig(&env, &caller)?;
//!
//! // Validate that a proposal has sufficient approvals:
//! MultisigGuard::validate_proposal_approval(&env, proposal_id)?;
//!
//! // Require either single-admin or multisig-approved execution:
//! MultisigGuard::require_admin_or_multisig(&env, &caller)?;
//! ```

use crate::errors::Error;
use soroban_sdk::{contracttype, symbol_short, Address, Env, Vec};

/// Storage keys for multisig guard state within manage_hub.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MultisigDataKey {
    /// The address of the deployed access_control contract.
    AccessControlContract,
    /// Maps an operation identifier to its required approval threshold.
    OperationThreshold(String),
    /// Tracks whether the multisig system is initialized in manage_hub.
    MultisigInitialized,
}

/// Classification of operations by their sensitivity level.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationSensitivity {
    /// Standard operations — single admin is sufficient.
    Standard,
    /// Sensitive operations — require multisig approval.
    Sensitive,
    /// Critical operations — require enhanced multisig threshold.
    Critical,
}

impl OperationSensitivity {
    /// Return the human-readable label for this sensitivity level.
    pub fn as_str(&self) -> &'static str {
        match self {
            OperationSensitivity::Standard => "standard",
            OperationSensitivity::Sensitive => "sensitive",
            OperationSensitivity::Critical => "critical",
        }
    }
}

/// Result of a multisig validation check.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigValidationResult {
    /// Whether multisig is enabled for the operation.
    pub multisig_enabled: bool,
    /// Number of approvals currently gathered.
    pub current_approvals: u32,
    /// Number of approvals required.
    pub required_approvals: u32,
    /// Whether the operation has met the threshold.
    pub has_sufficient_approvals: bool,
}

pub struct MultisigGuard;

impl MultisigGuard {
    /// Initialize multisig guard state in the manage_hub contract.
    ///
    /// Stores the access_control contract address so subsequent guard checks
    /// can query multisig configuration from the access_control contract.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `access_control_contract` - Address of the deployed access_control contract
    ///
    /// # Errors
    /// * `Error::Unauthorized` - Caller is not an admin
    /// * `Error::SubscriptionAlreadyExists` - Multisig already initialized
    pub fn initialize(
        env: &Env,
        caller: Address,
        access_control_contract: Address,
    ) -> Result<(), Error> {
        Self::require_admin_guard(env, &caller)?;

        if Self::is_initialized(env) {
            return Err(Error::SubscriptionAlreadyExists);
        }

        env.storage().instance().set(
            &MultisigDataKey::AccessControlContract,
            &access_control_contract,
        );
        env.storage()
            .instance()
            .set(&MultisigDataKey::MultisigInitialized, &true);

        env.events().publish(
            (symbol_short!("ms_init"), caller.clone()),
            access_control_contract,
        );

        Ok(())
    }

    /// Check whether the multisig guard system has been initialized.
    pub fn is_initialized(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<MultisigDataKey, bool>(&MultisigDataKey::MultisigInitialized)
            .unwrap_or(false)
    }

    /// Retrieve the stored access_control contract address.
    pub fn get_access_control_address(env: &Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&MultisigDataKey::AccessControlContract)
    }

    /// Register a required approval threshold for a named operation.
    ///
    /// This allows the manage_hub to declare that certain operations
    /// (e.g., `set_usdc_contract`, `set_admin`) require multisig approval
    /// even when the access_control contract is operating in single-admin mode.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - Admin address
    /// * `operation_name` - Unique identifier for the operation
    /// * `required_approvals` - Number of approvals required (0 = standard single-admin)
    ///
    /// # Errors
    /// * `Error::Unauthorized` - Caller is not an admin
    /// * `Error::InvalidPaymentAmount` - Required approvals is 0 (use standard guard instead)
    pub fn set_operation_threshold(
        env: &Env,
        caller: Address,
        operation_name: String,
        required_approvals: u32,
    ) -> Result<(), Error> {
        Self::require_admin_guard(env, &caller)?;

        if required_approvals == 0 {
            return Err(Error::InvalidPaymentAmount);
        }

        env.storage().instance().set(
            &MultisigDataKey::OperationThreshold(operation_name.clone()),
            &required_approvals,
        );

        env.events().publish(
            (symbol_short!("op_thresh"), operation_name),
            required_approvals,
        );

        Ok(())
    }

    /// Get the required approval threshold for a named operation.
    ///
    /// Returns `None` if no custom threshold has been registered, meaning
    /// the operation follows default admin-only authorization.
    pub fn get_operation_threshold(env: &Env, operation_name: &String) -> Option<u32> {
        env.storage()
            .instance()
            .get::<MultisigDataKey, u32>(&MultisigDataKey::OperationThreshold(
                operation_name.clone(),
            ))
    }

    /// Determine whether a specific operation requires multisig approval.
    ///
    /// An operation requires multisig if:
    /// 1. A custom threshold has been registered for it (via `set_operation_threshold`), OR
    /// 2. The access_control contract reports multisig is enabled (checked via cross-contract call)
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `operation_name` - The operation to check
    ///
    /// # Returns
    /// * `true` if multisig approval is needed for this operation
    pub fn operation_requires_multisig(env: &Env, operation_name: &String) -> bool {
        // First check if there's a custom threshold for this operation
        if let Some(threshold) = Self::get_operation_threshold(env, operation_name) {
            return threshold > 1;
        }

        // Fall back to checking if the access_control contract has multisig enabled
        if let Some(ac_address) = Self::get_access_control_address(env) {
            let symbol = Symbol::new(env, "is_multisig_enabled");
            let args: Vec<Bool> = Vec::new(env);
            match env.try_invoke_contract::<bool, Error>(&ac_address, &symbol, args) {
                Ok(Ok(enabled)) => enabled,
                _ => false,
            }
        } else {
            false
        }
    }

    /// Require that an operation either does not need multisig, or that the
    /// caller is an authorized admin (first step before proposal creation).
    ///
    /// This is the entry-point guard for operations that *may* require multisig:
    /// if multisig is not needed, the single admin is authorized directly;
    /// if multisig *is* needed, the caller must still be an admin to create
    /// a proposal.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - Address performing the operation
    /// * `operation_name` - Name of the operation being attempted
    ///
    /// # Errors
    /// * `Error::Unauthorized` - Caller is not an admin
    pub fn require_admin_or_multisig(
        env: &Env,
        caller: &Address,
        operation_name: &String,
    ) -> Result<(), Error> {
        // Caller must always be an admin (whether single-admin or multisig mode)
        Self::require_admin_guard(env, caller)?;

        // If the operation requires multisig, we allow the call through —
        // the actual multisig validation happens at execution time via
        // proposal approval. The admin is authorized to *create* the proposal.
        let _ = Self::operation_requires_multisig(env, operation_name);

        Ok(())
    }

    /// Validate that a proposal has received sufficient approvals for execution.
    ///
    /// This guard is intended to be called before executing an operation that
    /// was routed through the multisig proposal system.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `operation_name` - The operation to validate
    /// * `current_approvals` - Number of approvals the proposal has received
    ///
    /// # Returns
    /// * `Ok(MultisigValidationResult)` with full validation details
    /// * `Err(Error::InsufficientBalance)` if required approvals cannot be determined
    pub fn validate_proposal_approval(
        env: &Env,
        operation_name: &String,
        current_approvals: u32,
    ) -> Result<MultisigValidationResult, Error> {
        let required = Self::get_operation_threshold(env, operation_name).unwrap_or(1);

        let multisig_enabled = Self::operation_requires_multisig(env, operation_name);

        Ok(MultisigValidationResult {
            multisig_enabled,
            current_approvals,
            required_approvals: required,
            has_sufficient_approvals: current_approvals >= required,
        })
    }

    /// Check if an operation requires multisig and return the sensitivity level.
    ///
    /// Uses the registered threshold to classify operations:
    /// - threshold <= 1: Standard
    /// - threshold 2-3: Sensitive
    /// - threshold >= 4: Critical
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `operation_name` - The operation to classify
    pub fn get_operation_sensitivity(
        env: &Env,
        operation_name: &String,
    ) -> OperationSensitivity {
        let threshold = Self::get_operation_threshold(env, operation_name).unwrap_or(1);

        if threshold <= 1 {
            OperationSensitivity::Standard
        } else if threshold <= 3 {
            OperationSensitivity::Sensitive
        } else {
            OperationSensitivity::Critical
        }
    }

    /// Internal helper: require that the caller has admin privileges.
    ///
    /// Queries the access_control contract to verify admin status, or falls
    /// back to the manage_hub's own admin storage if no access_control
    /// contract is configured.
    fn require_admin_guard(env: &Env, caller: &Address) -> Result<(), Error> {
        // Check manage_hub's own admin first
        let own_admin: Option<Address> =
            env.storage().instance().get(&crate::membership_token::DataKey::Admin);

        if let Some(admin) = own_admin {
            if admin == *caller {
                return Ok(());
            }
        }

        // If access_control contract is configured, delegate the check
        if let Some(ac_address) = Self::get_access_control_address(env) {
            let symbol = Symbol::new(env, "is_admin");
            let args = soroban_sdk::vec![env, caller.clone()];
            match env.try_invoke_contract::<bool, Error>(&ac_address, &symbol, args) {
                Ok(Ok(is_admin)) => {
                    if is_admin {
                        return Ok(());
                    }
                }
                _ => {}
            }
        }

        Err(Error::Unauthorized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_operation_sensitivity_classification() {
        let env = Env::default();

        // Set up storage with various thresholds
        env.as(|| {
            // threshold 1 = Standard
            let name_low = String::from_str(&env, "low_op");
            env.storage().instance().set(
                &MultisigDataKey::OperationThreshold(name_low.clone()),
                &1u32,
            );
            assert_eq!(
                MultisigGuard::get_operation_sensitivity(&env, &name_low),
                OperationSensitivity::Standard
            );

            // threshold 2 = Sensitive
            let name_med = String::from_str(&env, "med_op");
            env.storage().instance().set(
                &MultisigDataKey::OperationThreshold(name_med.clone()),
                &2u32,
            );
            assert_eq!(
                MultisigGuard::get_operation_sensitivity(&env, &name_med),
                OperationSensitivity::Sensitive
            );

            // threshold 4 = Critical
            let name_high = String::from_str(&env, "high_op");
            env.storage().instance().set(
                &MultisigDataKey::OperationThreshold(name_high.clone()),
                &4u32,
            );
            assert_eq!(
                MultisigGuard::get_operation_sensitivity(&env, &name_high),
                OperationSensitivity::Critical
            );

            // no threshold = Standard (default)
            let name_none = String::from_str(&env, "none_op");
            assert_eq!(
                MultisigGuard::get_operation_sensitivity(&env, &name_none),
                OperationSensitivity::Standard
            );
        });
    }

    #[test]
    fn test_operation_requires_multisig_with_custom_threshold() {
        let env = Env::default();

        env.as(|| {
            let op_name = String::from_str(&env, "set_usdc");

            // No threshold set — does not require multisig
            assert!(!MultisigGuard::operation_requires_multisig(&env, &op_name));

            // Set threshold to 1 — still standard (single admin)
            env.storage().instance().set(
                &MultisigDataKey::OperationThreshold(op_name.clone()),
                &1u32,
            );
            assert!(!MultisigGuard::operation_requires_multisig(&env, &op_name));

            // Set threshold to 2 — requires multisig
            env.storage().instance().set(
                &MultisigDataKey::OperationThreshold(op_name.clone()),
                &2u32,
            );
            assert!(MultisigGuard::operation_requires_multisig(&env, &op_name));
        });
    }

    #[test]
    fn test_validate_proposal_approval() {
        let env = Env::default();

        env.as(|| {
            let op_name = String::from_str(&env, "critical_op");
            env.storage().instance().set(
                &MultisigDataKey::OperationThreshold(op_name.clone()),
                &3u32,
            );

            // 2 approvals < 3 required
            let result =
                MultisigGuard::validate_proposal_approval(&env, &op_name, 2).unwrap();
            assert_eq!(result.current_approvals, 2);
            assert_eq!(result.required_approvals, 3);
            assert!(!result.has_sufficient_approvals);
            assert!(result.multisig_enabled);

            // 3 approvals >= 3 required
            let result =
                MultisigGuard::validate_proposal_approval(&env, &op_name, 3).unwrap();
            assert!(result.has_sufficient_approvals);
        });
    }

    #[test]
    fn test_is_initialized_default() {
        let env = Env::default();
        env.as(|| {
            assert!(!MultisigGuard::is_initialized(&env));
        });
    }

    #[test]
    fn test_get_operation_threshold_none() {
        let env = Env::default();
        env.as(|| {
            let name = String::from_str(&env, "nonexistent");
            assert_eq!(MultisigGuard::get_operation_threshold(&env, &name), None);
        });
    }

    #[test]
    fn test_get_operation_threshold_set() {
        let env = Env::default();
        env.as(|| {
            let name = String::from_str(&env, "my_op");
            env.storage()
                .instance()
                .set(&MultisigDataKey::OperationThreshold(name.clone()), &5u32);
            assert_eq!(
                MultisigGuard::get_operation_threshold(&env, &name),
                Some(5)
            );
        });
    }

    #[test]
    fn test_sensitivity_as_str() {
        assert_eq!(OperationSensitivity::Standard.as_str(), "standard");
        assert_eq!(OperationSensitivity::Sensitive.as_str(), "sensitive");
        assert_eq!(OperationSensitivity::Critical.as_str(), "critical");
    }

    #[test]
    fn test_multisig_validation_result_fields() {
        let result = MultisigValidationResult {
            multisig_enabled: true,
            current_approvals: 4,
            required_approvals: 3,
            has_sufficient_approvals: true,
        };
        assert!(result.multisig_enabled);
        assert_eq!(result.current_approvals, 4);
        assert_eq!(result.required_approvals, 3);
        assert!(result.has_sufficient_approvals);
    }
}
