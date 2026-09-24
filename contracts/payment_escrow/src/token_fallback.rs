// contracts/payment_escrow/src/token_fallback.rs

use soroban_sdk::{contracterror, contracttype, token, Address, Env, IntoVal, String};

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
    /// A callback referenced an escrow that already exists.
    EscrowAlreadyClaimed = 4,
    /// Only the contract administrator may change the supported-token set.
    Unauthorized = 5,
}

/// Storage keys owned by the fallback handler.
///
/// Kept separate from the contract's main `DataKey` so the allowlist and the
/// callback claims cannot collide with escrow records.
#[contracttype]
pub enum FallbackDataKey {
    /// Explicitly allowlisted token contracts.
    SupportedToken(Address),
    /// Escrow ids already claimed by an inbound callback.
    ClaimedEscrow(String),
}

pub struct TokenFallbackHandler;

impl TokenFallbackHandler {
    /// Allowlist a token contract (administrator only).
    ///
    /// Recovery of an unrelated asset is still possible, but it must be an
    /// explicit, authorised decision rather than something the contract
    /// infers from an inbound transfer.
    pub fn add_supported_token(
        env: &Env,
        admin: &Address,
        token: &Address,
    ) -> Result<(), UnsupportedTokenError> {
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&FallbackDataKey::SupportedToken(token.clone()), &true);
        Ok(())
    }

    /// Remove a token contract from the allowlist (administrator only).
    pub fn remove_supported_token(
        env: &Env,
        admin: &Address,
        token: &Address,
    ) -> Result<(), UnsupportedTokenError> {
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&FallbackDataKey::SupportedToken(token.clone()));
        Ok(())
    }

    /// Whether `token` is accepted by this contract.
    ///
    /// Support is an explicit allowlist rather than a probe of the token
    /// contract. Probing only proves that *some* contract exists at the
    /// address, which would accept any unrelated asset that happens to
    /// implement the token interface.
    pub fn is_token_supported(env: &Env, token: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&FallbackDataKey::SupportedToken(token.clone()))
            .unwrap_or(false)
    }

    /// Reject any asset that is not on the allowlist.
    pub fn require_supported_token(
        env: &Env,
        token: &Address,
    ) -> Result<(), UnsupportedTokenError> {
        if !Self::is_token_supported(env, token) {
            return Err(UnsupportedTokenError::TokenNotSupported);
        }
        Ok(())
    }

    /// Handle an inbound token callback for `escrow_id`.
    ///
    /// Refuses unsupported assets, and refuses an escrow id that has already
    /// been claimed — a callback must never be able to overwrite an escrow
    /// that already exists. The claim is recorded only after every check
    /// passes, so a rejected callback leaves no state behind.
    pub fn handle_token_callback(
        env: &Env,
        token: &Address,
        escrow_id: &String,
        amount: &i128,
    ) -> Result<(), UnsupportedTokenError> {
        if *amount <= 0 {
            return Err(UnsupportedTokenError::TransferFailed);
        }

        Self::require_supported_token(env, token)?;

        if env
            .storage()
            .persistent()
            .has(&FallbackDataKey::ClaimedEscrow(escrow_id.clone()))
        {
            return Err(UnsupportedTokenError::EscrowAlreadyClaimed);
        }

        env.storage()
            .persistent()
            .set(&FallbackDataKey::ClaimedEscrow(escrow_id.clone()), &true);

        Ok(())
    }

    /// Whether an inbound callback has already claimed `escrow_id`.
    pub fn is_escrow_claimed(env: &Env, escrow_id: &String) -> bool {
        env.storage()
            .persistent()
            .has(&FallbackDataKey::ClaimedEscrow(escrow_id.clone()))
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
        // Reject zero-amount and negative transfers.
        if *amount <= 0 {
            return Err(UnsupportedTokenError::TransferFailed);
        }

        Self::require_supported_token(env, token)?;

        let client = token::Client::new(env, token);

        // Check balance first
        let balance = client.balance(from);
        if balance < *amount {
            return Err(UnsupportedTokenError::InsufficientBalance);
        }

        // Perform the transfer
        let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
            token,
            &soroban_sdk::symbol_short!("transfer"),
            (from.clone(), to.clone(), *amount).into_val(env),
        );

        match result {
            Ok(Ok(())) => Ok(()),
            _ => Err(UnsupportedTokenError::TransferFailed),
        }
    }
}
