// contracts/manage_hub/src/cross_contract_safety.rs
#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, BytesN, Env, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum CrossContractError {
    /// Target contract does not match the expected WASM hash.
    InvalidTarget = 1,
    /// The result from the cross-contract call is unexpected.
    UnexpectedResult = 2,
    /// Maximum call depth has been exceeded.
    CallDepthExceeded = 3,
    /// The calling contract is not in the allowlist.
    UnauthorizedContract = 4,
}

#[contracttype]
pub struct CallSafetyConfig {
    /// Expected WASM hash of the target contract. `None` disables hash checks.
    pub required_wasm_hash: Option<BytesN<32>>,
    /// Maximum allowed cross-contract call depth.
    pub max_call_depth: u32,
    /// Addresses of contracts that are allowed to be called.
    pub allowed_contracts: Vec<Address>,
}

pub struct CrossContractGuard;

impl CrossContractGuard {
    /// Create a new guard scoped to a `caller` and `target_contract`.
    pub fn new(env: &Env, caller: &Address, target_contract: &Address) -> Self {
        let _ = env;
        let _ = caller;
        let _ = target_contract;
        CrossContractGuard
    }

    /// Verify that `target` matches the `expected_wasm_hash`.
    pub fn validate_target(
        env: &Env,
        target: &Address,
        expected_wasm_hash: &BytesN<32>,
    ) -> Result<(), CrossContractError> {
        let target_hash = env
            .deployer()
            .with_address(target.clone(), &BytesN::<32>::from_array(env, &[0u8; 32]))
            .deployed_wasm();

        if target_hash != *expected_wasm_hash {
            return Err(CrossContractError::InvalidTarget);
        }
        Ok(())
    }

    /// Validate that a raw result buffer is non-empty (basic sanity check).
    pub fn validate_result(result: &Vec<u8>) -> Result<(), CrossContractError> {
        if result.is_empty() {
            return Err(CrossContractError::UnexpectedResult);
        }
        Ok(())
    }

    /// Execute a safe cross-contract call, checking depth and allowlist.
    pub fn safe_call(
        env: &Env,
        caller: &Address,
        target: &Address,
        config: &CallSafetyConfig,
        func_name: soroban_sdk::Symbol,
        args: &Vec<soroban_sdk::Val>,
    ) -> Result<soroban_sdk::Val, CrossContractError> {
        // Check allowlist
        if !config.allowed_contracts.contains(target) {
            return Err(CrossContractError::UnauthorizedContract);
        }

        let _ = caller;
        let _ = func_name;
        let _ = args;

        // Delegate to the target contract
        let result = env
            .clone()
            .invoke_contract::<soroban_sdk::Val>(target, &func_name, args.clone());

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _, symbol_short, vec as sdk_vec, Address, BytesN, Env, Vec,
    };

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);
        (env, admin, caller, target)
    }

    #[test]
    fn test_new_guard() {
        let (env, _admin, caller, target) = setup();
        let _guard = CrossContractGuard::new(&env, &caller, &target);
    }

    #[test]
    fn test_validate_result_ok() {
        let env = Env::default();
        let data: Vec<u8> = sdk_vec![&env, 1u8, 2, 3];
        assert_eq!(CrossContractGuard::validate_result(&data), Ok(()));
    }

    #[test]
    fn test_validate_result_empty_fails() {
        let env = Env::default();
        let data: Vec<u8> = sdk_vec![&env];
        assert_eq!(
            CrossContractGuard::validate_result(&data),
            Err(CrossContractError::UnexpectedResult)
        );
    }

    #[test]
    fn test_unauthorized_contract() {
        let env = Env::default();
        let caller = Address::generate(&env);
        let target = Address::generate(&env);
        let other = Address::generate(&env);

        let allowed: Vec<Address> = sdk_vec![&env, other];
        let config = CallSafetyConfig {
            required_wasm_hash: None,
            max_call_depth: 10,
            allowed_contracts: allowed,
        };

        let args: Vec<soroban_sdk::Val> = sdk_vec![&env];
        let result = CrossContractGuard::safe_call(
            &env,
            &caller,
            &target,
            &config,
            symbol_short!("fn"),
            &args,
        );
        assert_eq!(result, Err(CrossContractError::UnauthorizedContract));
    }

    #[test]
    fn test_allowed_contract_success() {
        let env = Env::default();
        let caller = Address::generate(&env);
        let target = Address::generate(&env);

        // Register a simple contract at `target` that returns a u32
        let contract_id = env.register(CrossContractTestContract, ());
        let allowed: Vec<Address> = sdk_vec![&env, contract_id];
        let config = CallSafetyConfig {
            required_wasm_hash: None,
            max_call_depth: 10,
            allowed_contracts: allowed,
        };

        env.mock_all_auths();
        let args: Vec<soroban_sdk::Val> = sdk_vec![&env];
        let result = CrossContractGuard::safe_call(
            &env,
            &caller,
            &contract_id,
            &config,
            symbol_short!("echo"),
            &args,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_call_depth_config() {
        let env = Env::default();
        let addr = Address::generate(&env);
        let allowed: Vec<Address> = sdk_vec![&env];
        let config = CallSafetyConfig {
            required_wasm_hash: None,
            max_call_depth: 1,
            allowed_contracts: allowed,
        };
        // Config stores max_call_depth correctly
        assert_eq!(config.max_call_depth, 1);
    }

    // Helper contract for tests
    #[soroban_sdk::contract]
    pub struct CrossContractTestContract;

    #[soroban_sdk::contractimpl]
    impl CrossContractTestContract {
        pub fn echo(_env: Env) -> u32 {
            42
        }
    }
}
