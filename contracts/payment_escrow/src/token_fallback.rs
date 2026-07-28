// contracts/payment_escrow/src/token_fallback.rs
#![no_std]

use soroban_sdk::{contracterror, contractimpl, contracttype, Address, Env, TokenClient};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum UnsupportedTokenError {
    /// The token contract is not supported.
    TokenNotSupported = 1,
    /// The token transfer failed.
    TransferFailed = 2,
    /// The sender has insufficient balance.
    InsufficientBalance = 3,
}

#[contracttype]
pub struct TokenFallbackHandler;

impl TokenFallbackHandler {
    /// Check whether a token contract is supported by probing its balance entry.
    pub fn is_token_supported(env: &Env, token: &Address) -> bool {
        // A valid Soroban token contract exposes a `balance` entrypoint.
        // We probe with a dummy address; an unsupported address will not panic
        // but a missing contract will cause an error.
        let client = TokenClient::new(env, token);
        let probe = Address::generate(env);
        // If this returns (even 0), the token contract exists.
        env.try_invoke_contract::<i128, _>(token, &soroban_sdk::symbol_short!("balance"), (
            probe,
        ))
        .is_ok()
    }

    /// Attempt a token transfer with fallback handling.
    ///
    /// On any error the function returns a clear `Err` — no partial state is
    /// mutated.
    pub fn try_transfer_with_fallback(
        env: &Env,
        token: &Address,
        from: &Address,
        to: &Address,
        amount: &i128,
    ) -> Result<(), UnsupportedTokenError> {
        if !Self::is_token_supported(env, token) {
            return Err(UnsupportedTokenError::TokenNotSupported);
        }

        let client = TokenClient::new(env, token);

        // Check balance first
        let balance = client.balance(from);
        if balance < *amount {
            return Err(UnsupportedTokenError::InsufficientBalance);
        }

        // Perform the transfer
        let result = env.try_invoke_contract::<(), _>(
            token,
            &soroban_sdk::symbol_short!("transfer"),
            (from.clone(), to.clone(), amount.clone()),
        );

        match result {
            Ok(()) => Ok(()),
            Err(_) => Err(UnsupportedTokenError::TransferFailed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _, token::StellarAssetClient, Address, Env,
    };

    fn setup_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
        let token_address = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        StellarAssetClient::new(env, &token_address)
            .mock_all_auths()
            .mint(recipient, &amount);
        token_address
    }

    #[test]
    fn test_is_token_supported() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token = setup_token(&env, &admin, &user, 1_000);
        assert!(TokenFallbackHandler::is_token_supported(&env, &token));
    }

    #[test]
    fn test_is_token_unsupported() {
        let env = Env::default();
        let bogus = Address::generate(&env);
        assert!(!TokenFallbackHandler::is_token_supported(&env, &bogus));
    }

    #[test]
    fn test_transfer_success() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let token = setup_token(&env, &admin, &from, 5_000);

        let result =
            TokenFallbackHandler::try_transfer_with_fallback(&env, &token, &from, &to, &2_000);
        assert_eq!(result, Ok(()));

        let client = TokenClient::new(&env, &token);
        assert_eq!(client.balance(&to), 2_000);
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let token = setup_token(&env, &admin, &from, 100);

        let result =
            TokenFallbackHandler::try_transfer_with_fallback(&env, &token, &from, &to, &200);
        assert_eq!(result, Err(UnsupportedTokenError::InsufficientBalance));
    }

    #[test]
    fn test_transfer_unsupported_token() {
        let env = Env::default();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let bogus = Address::generate(&env);

        let result =
            TokenFallbackHandler::try_transfer_with_fallback(&env, &bogus, &from, &to, &100);
        assert_eq!(result, Err(UnsupportedTokenError::TokenNotSupported));
    }

    #[test]
    fn test_transfer_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let token = setup_token(&env, &admin, &from, 1_000);

        let result =
            TokenFallbackHandler::try_transfer_with_fallback(&env, &token, &from, &to, &0);
        assert_eq!(result, Ok(()));
    }
}
