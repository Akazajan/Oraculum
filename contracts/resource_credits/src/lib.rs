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

/// Storage keys for the contract.
#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    Balance(Address),
    TotalSupply,
    /// C32: marks an issuance reference as consumed so it cannot be replayed.
    Issued(u64),
}

#[contract]
pub struct ResourceCreditsContract;

#[contractimpl]
impl ResourceCreditsContract {
    // ── Internal helpers ─────────────────────────────────────────────────────

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

    /// C33: authorize `caller` as the owner of `owner`'s credits.
    ///
    /// Credits are only ever moved by the account that holds them, so the
    /// caller and the owner must be the same address. The mismatch is
    /// rejected before `require_auth`, so an unrelated caller gets
    /// `Unauthorized` rather than a signature prompt; the owner's signature
    /// is then required, so a call without it aborts.
    fn require_owner(caller: &Address, owner: &Address) -> Result<(), Error> {
        if caller != owner {
            return Err(Error::Unauthorized);
        }
        owner.require_auth();
        Ok(())
    }

    /// C31: debit `amount` from `balance` with checked arithmetic.
    ///
    /// A debit larger than the balance is rejected with
    /// `InsufficientBalance` instead of underflowing into a huge (effectively
    /// negative) balance.
    fn checked_debit(balance: u128, amount: u128) -> Result<u128, Error> {
        balance
            .checked_sub(amount)
            .ok_or(Error::InsufficientBalance)
    }

    /// Reject a zero-value credit operation.
    ///
    /// Minting, transferring or spending zero credits moves nothing but still
    /// writes balances and emits an event, which makes the transaction
    /// history misleading. Every credit-moving entry point runs this before
    /// touching storage, so a zero-value call fails with no state change.
    fn require_nonzero(amount: u128) -> Result<(), Error> {
        if amount == 0 {
            return Err(Error::InvalidAmount);
        }
        Ok(())
    }

    /// Validate that the payment token has been configured.
    fn require_payment_token(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .ok_or(Error::PaymentTokenNotSet)
    }

    // ── Public entry points ───────────────────────────────────────────────────

    /// Initialize the contract with an admin and payment token.
    ///
    /// CT-14: Both `admin` and `payment_token` are validated before any
    /// storage write. Initialization is rejected when:
    /// - the contract is already initialized, or
    /// - `payment_token` is the same address as `admin` (would misroute fees).
    pub fn initialize(env: Env, admin: Address, payment_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        // Reject configurations where the payment token and admin are the same
        // address, which would silently misroute all fee payments to the admin.
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
        Self::require_payment_token(&env)
    }

    /// Mint credits to a recipient (admin only).
    ///
    /// CT-02: increases recipient balance and TotalSupply.
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

        Self::require_nonzero(amount)?;

        let issued_key = DataKey::Issued(issuance_reference);
        if env.storage().persistent().has(&issued_key) {
            return Err(Error::DuplicateIssuance);
        }

        // Both sums are resolved before either is stored, so an overflow on
        // the supply cannot leave a credited balance behind (and does not
        // consume the issuance reference).
        let new_bal = Self::balance_of(&env, &recipient)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        let new_supply = Self::supply(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        Self::set_balance(&env, &recipient, new_bal);
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
    /// CT-03: sender balance decremented, recipient balance incremented.
    ///
    /// #919: both new balances are computed - including the recipient's
    /// checked addition - before either is written to storage. If the
    /// recipient update would overflow, nothing is written: the sender keeps
    /// their full balance instead of losing the debited credits.
    ///
    /// `caller` must be the account the credits are debited from.
    pub fn transfer_credits(
        env: Env,
        caller: Address,
        from: Address,
        to: Address,
        amount: u128,
    ) -> Result<(), Error> {
        // Reject self-transfers: they are no-ops and emit a misleading event.
        if from == to {
            return Err(Error::SelfTransfer);
        }

        // Checked before `require_auth` so a zero-value transfer fails
        // outright instead of first prompting the holder for a signature.
        Self::require_nonzero(amount)?;
        Self::require_owner(&caller, &from)?;

        // Confirm the payment token is configured before touching any state.
        Self::require_payment_token(&env)?;

        // Resolve both sides before writing either, so a failure here leaves
        // both balances exactly as they were. C31: the sender's debit is
        // checked and cannot underflow; the recipient's addition is checked
        // so a large balance cannot wrap to a smaller one.
        let new_from = Self::checked_debit(Self::balance_of(&env, &from), amount)?;
        let new_to = Self::balance_of(&env, &to)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

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
        // As in `transfer_credits`: a zero-value spend never reaches auth.
        Self::require_nonzero(amount)?;
        Self::require_owner(&caller, &member)?;

        // C31: checked on both sides. The member's debit cannot underflow,
        // and an unchecked `supply - amount` would wrap to a huge total
        // supply if the two ever drifted apart.
        let new_bal = Self::checked_debit(Self::balance_of(&env, &member), amount)?;
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
