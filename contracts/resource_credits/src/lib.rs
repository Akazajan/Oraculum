#![no_std]

// The env.events().publish() API is deprecated in favour of #[contractevent],
// kept here for consistency with the rest of the Oraculum contracts.
#![allow(deprecated)]

mod errors;
mod types;
#[cfg(test)]
mod test;

use errors::Error;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

/// Storage keys for the contract.
#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    Balance(Address),
    TotalSupply,
    TransactionHistory(Address),
}

#[contract]
pub struct ResourceCreditsContract;

#[contractimpl]
impl ResourceCreditsContract {
    // ── Internal helpers ──────────────────────────────────────────────────────

    fn balance_of(env: &Env, member: &Address) -> u128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(member.clone()))
            .unwrap_or(0u128)
    }

    fn set_balance(env: &Env, member: &Address, amount: u128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(member.clone()), &amount);
    }

    fn supply(env: &Env) -> u128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0u128)
    }

    /// Authorize `caller` as the owner of `owner`'s credits.
    ///
    /// Credits are only ever moved by the account that holds them, so the
    /// caller and the owner must be the same address. The mismatch is
    /// rejected before `require_auth`, so an unrelated caller gets
    /// `Unauthorized` rather than a signature prompt.
    fn require_owner(caller: &Address, owner: &Address) -> Result<(), Error> {
        if caller != owner {
            return Err(Error::Unauthorized);
        }
        owner.require_auth();
        Ok(())
    }

    /// Initialize the contract with an admin and payment token.
    pub fn initialize(env: Env, admin: Address, payment_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);
        env.storage().instance().set(&DataKey::TotalSupply, &0u128);
        Ok(())
    }

    /// Mint credits to a recipient (admin only).
    ///
    /// CT-02: increases recipient balance and TotalSupply.
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
        if amount == 0 {
            return Err(Error::InvalidAmount);
        }

        // Both sums are resolved before either is stored, so an overflow on
        // the supply cannot leave a credited balance behind.
        let bal = Self::balance_of(&env, &recipient);
        let new_bal = bal.checked_add(amount).ok_or(Error::Overflow)?;
        let new_supply = Self::supply(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        Self::set_balance(&env, &recipient, new_bal);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        env.events()
            .publish((symbol_short!("mint"), recipient), amount);
        Ok(())
    }

    /// Transfer credits from one member to another.
    ///
    /// CT-03: sender balance decremented, recipient balance incremented.
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
        Self::require_owner(&caller, &from)?;

        // Reject self-transfers: they are no-ops and emit a misleading event.
        if from == to {
            return Err(Error::InvalidAmount);
        }

        let from_bal = Self::balance_of(&env, &from);
        if from_bal < amount {
            return Err(Error::InsufficientBalance);
        }
        let to_bal = Self::balance_of(&env, &to);

        // Resolve both sides before writing either, so a failure here leaves
        // both balances exactly as they were. The recipient's addition is
        // checked: unchecked, a large balance could wrap to a smaller one.
        let new_from = from_bal.checked_sub(amount).ok_or(Error::Overflow)?;
        let new_to = to_bal.checked_add(amount).ok_or(Error::Overflow)?;

        Self::set_balance(&env, &from, new_from);
        Self::set_balance(&env, &to, new_to);

        env.events()
            .publish((symbol_short!("transfer"), from, to), amount);
        Ok(())
    }

    /// Spend (burn) credits from a member's balance.
    ///
    /// CT-04: decrements member balance and TotalSupply.
    ///
    /// `caller` must be the member whose credits are being spent.
    pub fn spend_credits(
        env: Env,
        caller: Address,
        member: Address,
        amount: u128,
    ) -> Result<(), Error> {
        if amount == 0 {
            return Err(Error::InvalidAmount);
        }
        Self::require_owner(&caller, &member)?;

        let bal = Self::balance_of(&env, &member);
        if bal < amount {
            return Err(Error::InsufficientBalance);
        }

        // Checked on both sides: an unchecked `supply - amount` would wrap to
        // a huge total supply if the two ever drifted apart.
        let new_bal = bal.checked_sub(amount).ok_or(Error::Overflow)?;
        let new_supply = Self::supply(&env)
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;

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
        Self::balance_of(&env, &member)
    }

    /// Get the total supply of credits.
    pub fn total_supply(env: Env) -> u128 {
        Self::supply(&env)
    }
}
