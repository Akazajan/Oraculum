#![no_std]
// The env.events().publish() API is deprecated in favour of #[contractevent],
// kept here for consistency with the rest of the Oraculum contracts.
#![allow(deprecated)]

mod errors;
#[cfg(test)]
mod test;
mod types;

use errors::Error;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PaymentToken,
    Balance(Address),
    TotalSupply,
    /// C32: marks an issuance reference as consumed so it cannot be replayed.
    Issued(u64),
}

fn balance_of(env: &Env, account: &Address) -> u128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(account.clone()))
        .unwrap_or(0u128)
}

fn set_balance(env: &Env, account: &Address, balance: u128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(account.clone()), &balance);
}

fn supply(env: &Env) -> u128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalSupply)
        .unwrap_or(0u128)
}

/// C33: authorize `caller` as the owner of `owner`'s credits.
///
/// Credits are only ever moved by the account that holds them, so the caller
/// and the owner must be the same address. A mismatch is rejected with
/// `Unauthorized` before any state is read, and the owner's signature is then
/// required via `require_auth`, so a transfer without the owner's
/// authorization aborts.
fn require_owner(caller: &Address, owner: &Address) -> Result<(), Error> {
    if caller != owner {
        return Err(Error::Unauthorized);
    }
    owner.require_auth();
    Ok(())
}

/// C31: debit `amount` from `balance` with checked arithmetic.
///
/// A debit larger than the balance is rejected with `InsufficientBalance`
/// instead of underflowing into a huge (effectively negative) balance.
fn checked_debit(balance: u128, amount: u128) -> Result<u128, Error> {
    balance
        .checked_sub(amount)
        .ok_or(Error::InsufficientBalance)
}

fn require_nonzero(amount: u128) -> Result<(), Error> {
    if amount == 0 {
        Err(Error::InvalidAmount)
    } else {
        Ok(())
    }
}

#[contract]
pub struct ResourceCreditsContract;

#[contractimpl]
impl ResourceCreditsContract {
    /// Initialize the contract with an admin and payment token.
    ///
    /// CT-14: rejects double initialization and a payment token equal to the
    /// admin address (which would misroute fees).
    pub fn initialize(env: Env, admin: Address, payment_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if payment_token == admin {
            return Err(Error::InvalidAddress);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);
        env.storage().instance().set(&DataKey::TotalSupply, &0u128);
        Ok(())
    }

    /// Return the configured payment token address.
    pub fn payment_token(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .ok_or(Error::PaymentTokenNotSet)
    }

    /// Mint credits to a recipient (admin only).
    ///
    /// C32: every issuance carries a unique `issuance_reference`. Once a
    /// reference has been used it is recorded, and any later mint with the
    /// same reference fails with `DuplicateIssuance`, so a replayed issuance
    /// cannot credit the recipient twice.
    pub fn mint_credits(
        env: Env,
        caller: Address,
        recipient: Address,
        amount: u128,
        issuance_reference: u64,
    ) -> Result<(), Error> {
        // Authorize first so a non-admin gets `Unauthorized` rather than a
        // descriptive validation error.
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

        let issued_key = DataKey::Issued(issuance_reference);
        if env.storage().persistent().has(&issued_key) {
            return Err(Error::DuplicateIssuance);
        }

        // Resolve both sums before writing, so an overflow leaves no partial
        // state (and does not consume the issuance reference).
        let new_balance = balance_of(&env, &recipient)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        let new_supply = supply(&env).checked_add(amount).ok_or(Error::Overflow)?;

        set_balance(&env, &recipient, new_balance);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);
        env.storage().persistent().set(&issued_key, &true);

        env.events().publish(
            (symbol_short!("mint"), recipient, issuance_reference),
            amount,
        );
        Ok(())
    }

    /// Whether an issuance reference has already been consumed (C32).
    pub fn is_issued(env: Env, issuance_reference: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Issued(issuance_reference))
    }

    /// Transfer credits from one member to another.
    ///
    /// C33: `caller` must be `from`, and `from` must authorize the call.
    /// C31: the sender's debit is checked and cannot underflow.
    pub fn transfer_credits(
        env: Env,
        caller: Address,
        from: Address,
        to: Address,
        amount: u128,
    ) -> Result<(), Error> {
        if from == to {
            return Err(Error::SelfTransfer);
        }
        require_nonzero(amount)?;
        require_owner(&caller, &from)?;

        let new_from = checked_debit(balance_of(&env, &from), amount)?;
        let new_to = balance_of(&env, &to)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        set_balance(&env, &from, new_from);
        set_balance(&env, &to, new_to);

        env.events()
            .publish((symbol_short!("transfer"), from, to), amount);
        Ok(())
    }

    /// Spend (burn) credits from a member's balance.
    ///
    /// `caller` must be the member. C31: the debit is checked and cannot
    /// underflow the balance or the total supply.
    pub fn spend_credits(
        env: Env,
        caller: Address,
        member: Address,
        amount: u128,
    ) -> Result<(), Error> {
        require_nonzero(amount)?;
        require_owner(&caller, &member)?;

        let new_balance = checked_debit(balance_of(&env, &member), amount)?;
        let new_supply = supply(&env).checked_sub(amount).ok_or(Error::Overflow)?;

        set_balance(&env, &member, new_balance);
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
        supply(&env)
    }
}
