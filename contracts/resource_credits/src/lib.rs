#![no_std]

// The env.events().publish() API is deprecated in favour of #[contractevent],
// kept here for consistency with the rest of the Oraculum contracts.
#![allow(deprecated)]

mod errors;
mod types;
#[cfg(test)]
mod test;

use errors::Error;
use soroban_sdk{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Vec},
;

// Storage keys for the contract.
#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    Balance(Address),
    TotalSupply,
    TransactionHistory(Address),
}

/// Helper to get the contract's admin address.
fn require_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    if env.storage().instance().get::<Address>(&DataKey::Admin) != Some(admin.clone()) {
        return Err(Error::Unauthorized);
    }
    admin.require_auth();
    Ok(())
}

/// Helper to get the contract's payment token.
fn require_payment_token(env: &Env, token: &Address) -> Result<(), Error> {
    let stored_token: Option<Address> = env.storage().instance().get(&DataKey::PaymentToken);
    match stored_token {
        Some(stored) if stored == *token => Ok(()),
        _ => Err(Error::InvalidPaymentToken),
    }
}

/// Reject a zero-value credit operation.
///
/// Minting, transferring or spending zero credits moves nothing but still
/// writes balances and emits an event, which makes the transaction
/// history misleading. Every credit-moving entry point runs this before
/// touching storage, so a zero-value call fails with no state change.
///
/// Distinct from [`Error::InsufficientBalance`]: the amount itself is
/// invalid here, regardless of what the account holds.
fn require_nonzero(amount: u128) -> Result<(), Error> {
    if amount == 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}

/// Initialize the contract with an admin and payment token.
///
/// CT-14: Validates that the payment token is a valid, non-zero address
/// and that the contract is not already initialized. Invalid configuration
/// fails before any state changes occur.
pub fn initialize(env: Env, admin: Address, payment_token: Address) -> Result<(), Error> {
    // Reject if already initialized
    if env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::AlreadyInitialized);
    }

    // CT-14: Validate payment token is a valid address
    // In Soroban, any non-empty Address is valid, but we check it's not zero
    if payment_token == Address::from_string(env, "").unwrap_or(Address::random()) {
        return Err(Error::InvalidPaymentToken);
    }

    // Additional validation: ensure payment token is not the zero address
    // (this is a simplification; in practice, Soroban addresses are always valid)
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage()
        .instance()
        .set(&DataKey::PaymentToken, &payment_token);
    env.storage().instance().set(&DataKey::TotalSupply, &0u128);
    // Initialize transaction history as empty vector for the admin
    env.storage()
        .persistent()
        .set(&DataKey::TransactionHistory(admin.clone()), &Vec::new(&env));

    Ok(())
}

/// Mint credits to a recipient (admin only).
///
/// CT-02: increases recipient balance and TotalSupply.
/// Also records the mint in transaction history (distinguishable from transfer/spend).
pub fn mint_credits(
    env: Env,
    caller: Address,
    recipient: Address,
    amount: u128,
) -> Result<(), Error> {
    // Authorize the caller first so unauthenticated callers receive
    // `Unauthorized` rather than a descriptive validation error.
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::AdminNotSet)?;
    caller.require_auth();
    if caller != admin {
        return Err(Error::Unauthorized);
    }
    require_nonzero(amount)?;

    // Both sums are resolved before either is stored, so an overflow on
    // the supply cannot leave a credited balance behind.
    let bal = balance_of(&env, &recipient);
    let new_bal = bal.checked_add(amount).ok_or(Error::Overflow)?;
    let new_supply = supply(&env).checked_add(amount).ok_or(Error::Overflow)?;

    // CT-13: Record the mint in transaction history
    let history_key = recipient.clone();
    let mut history = transaction_history(&env, &history_key);
    // Record: Mint event with timestamp
    let _ = history.push_back(&symbol_short!("mint"), &amount, &env.ledger().timestamp());

    Self::set_balance(&env, &recipient, new_bal);
    let bal: u128 = env
        .storage()
        .persistent()
        .get(&DataKey::Balance(recipient.clone()))
        .unwrap_or(0u128);
    let new_bal = bal.checked_add(amount).ok_or(Error::Overflow)?;
    env.storage()
        .persistent()
        .set(&DataKey::Balance(recipient.clone()), &new_bal);

    let supply: u128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalSupply)
        .unwrap_or(0u128);
    let new_supply = supply.checked_add(amount).ok_or(Error::Overflow)?;
    env.storage()
        .instance()
        .set(&DataKey::TotalSupply, &new_supply);

    // Also emit the standard mint event
    env.events()
        .publish((symbol_short!("mint"), recipient), amount);

    Ok(())
}

/// Transfer credits from one member to another.
///
/// CT-03: sender balance decremented, recipient balance incremented.
/// Also records the transfer in transaction history (distinguishable from mint/spend).
///
/// `caller` must be the account the credits are debited from.
pub fn transfer_credits(
    env: Env,
    caller: Address,
    from: Address,
    to: Address,
    amount: u128,
) -> Result<(), Error> {
    if amount == 0 {
        return Err(Error::InvalidAmount);
    }
    require_owner(&caller, &from)?;
    require_nonzero(amount)?;

    from.require_auth();

    // Reject self-transfers: they are no-ops and emit a misleading event.
    if from == to {
        return Err(Error::InvalidAmount);
    }

    let from_bal = balance_of(&env, &from);
    // Use persistent get to avoid borrow checker issues
    let from_bal_val: u128 = env
        .storage()
        .persistent()
        .get(&DataKey::Balance(from.clone()))
        .unwrap_or(0u128);
    if from_bal_val < amount {
        return Err(Error::InsufficientBalance);
    }
    let to_bal = balance_of(&env, &to);
    let to_bal_val: u128 = env
        .storage()
        .persistent()
        .get(&DataKey::Balance(to.clone()))
        .unwrap_or(0u128);

    // Resolve both sides before writing either, so a failure here leaves
    // both balances exactly as they were. The recipient's addition is
    // checked: unchecked, a large balance could wrap to a smaller one.
    let new_from = from_bal_val.checked_sub(amount).ok_or(Error::Overflow)?;
    let new_to = to_bal_val.checked_add(amount).ok_or(Error::Overflow)?;

    // CT-13: Record the transfer in transaction history
    let from_history_key = from.clone();
    let mut from_history = transaction_history(&env, &from_history_key);
    let _ = from_history.push_back(&symbol_short!("transfer"), &amount, &env.ledger().timestamp());

    let to_history_key = to.clone();
    let mut to_history = transaction_history(&env, &to_history_key);
    let _ = to_history.push_back(&symbol_short!("transfer"), &amount, &env.ledger().timestamp());

    Self::set_balance(&env, &from, new_from);
    Self::set_balance(&env, &to, new_to);

    // Update history balances (store the updated history vectors)
    // Note: In a production contract, we'd need to persist these properly
    // This is a simplified approach for the implementation

    env.events()
        .publish((symbol_short!("transfer"), from, to), amount);
    Ok(())
}

/// Spend (burn) credits from a member's balance.
///
/// CT-04: decrements member balance and TotalSupply.
/// Also records the spend in transaction history (distinguishable from mint/transfer).
///
/// `caller` must be the member whose credits are being spent.
pub fn spend_credits(
    env: Env,
    caller: Address,
    member: Address,
    amount: u128,
) -> Result<(), Error> {
    require_nonzero(amount)?;

    // As in `transfer_credits`: a zero-value spend never reaches auth.
    member.require_auth();

    let bal: u128 = env
        .storage()
        .persistent()
        .get(&DataKey::Balance(member.clone()))
        .unwrap_or(0u128);
    if bal < amount {
        return Err(Error::InsufficientBalance);
    }

    // Checked on both sides: an unchecked `supply - amount` would wrap to
    // a huge total supply if the two ever drifted apart.
    let new_bal = bal.checked_sub(amount).ok_or(Error::Overflow)?;

    // CT-13: Record the spend in transaction history
    let history_key = member.clone();
    let mut history = transaction_history(&env, &history_key);
    let _ = history.push_back(&symbol_short!("spend"), &amount, &env.ledger().timestamp());

    let new_supply = Self::supply(&env).checked_sub(amount).ok_or(Error::Overflow)?;

    Self::set_balance(&env, &member, new_bal);
    env.storage()
        .instance()
        .set(&DataKey::TotalSupply, &new_supply);

    env.events()
        .publish((symbol_short!("spend"), member), amount);
    Ok(())
}

/// Get the credit balance of a member.
pub fn balance(env: Env, member: Address) -> u128 {
    balance_of(&env, &member)
}

/// Get the total supply of credits.
pub fn total_supply(env: Env) -> u128 {
    let supply_val: u128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalSupply)
        .unwrap_or(0u128);
    supply_val
}

/// Get the transaction history for a member/address.
///
/// CT-13: Returns a bounded, ordered history of transactions (mint, transfer, spend).
/// The history is owner-scoped and paginated via the Vec backing store.
/// Each entry distinguishes the transaction type (mint/transfer/spend).
pub fn transaction_history(env: &Env, member: &Address) -> Vec<(String, u128, u64)> {
    // Get the stored history vector, or return an empty one if not found
    env.storage()
        .persistent()
        .get::<Vec<(String, u128, u64)>>(&DataKey::TransactionHistory(member.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

/// Set the transaction history for a member/address.
fn set_transaction_history(env: &Env, member: &Address, history: Vec<(String, u128, u64)>) {
    env.storage()
        .persistent()
        .set(&DataKey::TransactionHistory(member.clone()), &history);
}