// contracts/payment_escrow/src/lib.rs
#![no_std]
#![allow(deprecated)]
// return Err("Zero-address admin initialization not allowed");
mod errors;
pub mod token_fallback;
mod types;

#[cfg(test)]
mod test;
#[cfg(test)]
mod settlement_tests;
#[cfg(test)]
mod revenue_split_tests;

pub use errors::Error;
pub use types::{Escrow, EscrowStatus};

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Contract administrator address.
    Admin,
    /// Address of the accepted payment token.
    PaymentToken,
    /// Default dispute window in seconds (applied to every new escrow).
    DefaultDisputeWindow,
    /// Default fee recipient address.
    DefaultFeeRecipient,
    /// Default fee basis points.
    DefaultFeeBps,
    /// Escrow record keyed by escrow ID.
    Escrow(String),
    /// List of escrow IDs created by a depositor.
    DepositorEscrows(Address),
    /// List of escrow IDs where this address is the beneficiary.
    BeneficiaryEscrows(Address),
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentEscrowContract;

#[contractimpl]
impl PaymentEscrowContract {
    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AdminNotSet)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = Self::get_admin(env)?;
        if caller != &admin {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn get_payment_token(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .ok_or(Error::PaymentTokenNotSet)
    }

    fn get_dispute_window(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DefaultDisputeWindow)
            .unwrap_or(0u64)
    }

    fn get_fee_recipient(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::DefaultFeeRecipient)
            .ok_or(Error::FeeRecipientNotSet)
    }

    fn get_fee_bps(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DefaultFeeBps)
            .unwrap_or(0u32)
    }

    fn load_escrow(env: &Env, escrow_id: &String) -> Result<Escrow, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id.clone()))
            .ok_or(Error::EscrowNotFound)
    }

    fn save_escrow(env: &Env, escrow: &Escrow) {
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow.id.clone()), escrow);
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    /// One-time setup.
    ///
    /// * `admin`               — contract administrator.
    /// * `payment_token`       — the only accepted token for all escrows.
    /// * `dispute_window_secs` — seconds after escrow creation during which
    ///                           the depositor may raise a dispute (0 = disabled).
    pub fn initialize(
        env: Env,
        admin: Address,
        payment_token: Address,
        dispute_window_secs: u64,
        fee_recipient: Address,
        fee_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);
        env.storage()
            .instance()
            .set(&DataKey::DefaultDisputeWindow, &dispute_window_secs);
        env.storage()
            .instance()
            .set(&DataKey::DefaultFeeRecipient, &fee_recipient);
        env.storage()
            .instance()
            .set(&DataKey::DefaultFeeBps, &fee_bps);

        env.events().publish(
            (symbol_short!("init"),),
            (
                admin,
                payment_token,
                dispute_window_secs,
                fee_recipient,
                fee_bps,
            ),
        );
        Ok(())
    }

    // ── Admin configuration ───────────────────────────────────────────────────

    /// Update the default dispute window. Applies to escrows created after
    /// this call; existing escrows keep their original window.
    pub fn set_dispute_window(env: Env, caller: Address, window_secs: u64) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;
        env.storage()
            .instance()
            .set(&DataKey::DefaultDisputeWindow, &window_secs);

        env.events()
            .publish((symbol_short!("dw_set"),), (window_secs,));
        Ok(())
    }

    /// Update the default fee recipient.
    pub fn set_fee_recipient(env: Env, caller: Address, recipient: Address) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;
        env.storage()
            .instance()
            .set(&DataKey::DefaultFeeRecipient, &recipient);

        env.events()
            .publish((symbol_short!("feer_set"),), (recipient,));
        Ok(())
    }

    /// Update the default fee basis points.
    pub fn set_fee_bps(env: Env, caller: Address, fee_bps: u32) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;
        env.storage()
            .instance()
            .set(&DataKey::DefaultFeeBps, &fee_bps);

        env.events()
            .publish((symbol_short!("fbps_set"),), (fee_bps,));
        Ok(())
    }

    // ── Escrow creation ───────────────────────────────────────────────────────

    /// Lock funds in escrow.
    ///
    /// * `escrow_id`     — unique ID chosen by the caller (e.g. a UUID).
    /// * `beneficiary`   — address that receives funds on release.
    /// * `amount`        — tokens to lock (> 0).
    /// * `description`   — human-readable purpose.
    /// * `release_after` — Unix timestamp after which auto-claim is allowed
    ///                     (0 = auto-claim disabled; admin-only release).
    pub fn create_escrow(
        env: Env,
        depositor: Address,
        escrow_id: String,
        beneficiary: Address,
        amount: i128,
        description: String,
        release_after: u64,
    ) -> Result<(), Error> {
        depositor.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if depositor == beneficiary {
            return Err(Error::DepositorIsBeneficiary);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Escrow(escrow_id.clone()))
        {
            return Err(Error::EscrowAlreadyExists);
        }

        let payment_token = Self::get_payment_token(&env)?;
        let dispute_window = Self::get_dispute_window(&env);
        let now = env.ledger().timestamp();
        let fee_recipient = Self::get_fee_recipient(&env)?;
        let fee_bps = Self::get_fee_bps(&env);
        let fee_amount = (amount * fee_bps as i128) / 10_000;

        // Pull funds from depositor into the contract
        token::Client::new(&env, &payment_token).transfer(
            &depositor,
            env.current_contract_address(),
            &amount,
        );

        let escrow = Escrow {
            id: escrow_id.clone(),
            depositor: depositor.clone(),
            beneficiary: beneficiary.clone(),
            amount,
            payment_token,
            status: EscrowStatus::Pending,
            description,
            created_at: now,
            release_after,
            dispute_window,
            dispute_raised_at: None,
            resolved_at: None,
            fee_recipient,
            fee_bps,
            fee_amount,
        };

        Self::save_escrow(&env, &escrow);

        // Index: depositor → escrow IDs
        let mut dep_list: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::DepositorEscrows(depositor.clone()))
            .unwrap_or(Vec::new(&env));
        dep_list.push_back(escrow_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::DepositorEscrows(depositor.clone()), &dep_list);

        // Index: beneficiary → escrow IDs
        let mut ben_list: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::BeneficiaryEscrows(beneficiary.clone()))
            .unwrap_or(Vec::new(&env));
        ben_list.push_back(escrow_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::BeneficiaryEscrows(beneficiary.clone()), &ben_list);

        env.events().publish(
            (symbol_short!("created"), escrow_id),
            (depositor, beneficiary, amount, release_after),
        );
        Ok(())
    }

    // ── Admin release / refund (Pending escrows) ──────────────────────────────

    /// Release escrow funds to the beneficiary (admin only, Pending status).
    pub fn release(env: Env, caller: Address, escrow_id: String) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut escrow = Self::load_escrow(&env, &escrow_id)?;
        if escrow.status != EscrowStatus::Pending {
            return Err(Error::EscrowNotPending);
        }

        let now = env.ledger().timestamp();
        let token_client = token::Client::new(&env, &escrow.payment_token);

        // Transfer the fee, if any
        if escrow.fee_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.fee_recipient,
                &escrow.fee_amount,
            );
        }

        // Transfer the remaining amount to the beneficiary
        let beneficiary_amount = escrow.amount - escrow.fee_amount;
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.beneficiary,
            &beneficiary_amount,
        );

        escrow.status = EscrowStatus::Released;
        escrow.resolved_at = Some(now);
        Self::save_escrow(&env, &escrow);

        env.events().publish(
            (symbol_short!("released"), escrow_id),
            (
                escrow.beneficiary,
                beneficiary_amount,
                escrow.fee_recipient,
                escrow.fee_amount,
            ),
        );
        Ok(())
    }

    /// Refund escrow funds to the depositor (admin only, Pending status).
    pub fn refund(env: Env, caller: Address, escrow_id: String) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut escrow = Self::load_escrow(&env, &escrow_id)?;
        if escrow.status != EscrowStatus::Pending {
            return Err(Error::EscrowNotPending);
        }

        let now = env.ledger().timestamp();
        token::Client::new(&env, &escrow.payment_token).transfer(
            &env.current_contract_address(),
            &escrow.depositor,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Refunded;
        escrow.resolved_at = Some(now);
        Self::save_escrow(&env, &escrow);

        env.events().publish(
            (symbol_short!("refunded"), escrow_id),
            (escrow.depositor, escrow.amount),
        );
        Ok(())
    }

    // ── Dispute flow ──────────────────────────────────────────────────────────

    /// Raise a dispute on a Pending escrow.
    ///
    /// Only the depositor may call this, and only within the escrow's dispute
    /// window. Once disputed, only the admin can move the funds via
    /// `resolve_dispute`.
    pub fn raise_dispute(env: Env, caller: Address, escrow_id: String) -> Result<(), Error> {
        caller.require_auth();

        let mut escrow = Self::load_escrow(&env, &escrow_id)?;
        if escrow.status != EscrowStatus::Pending {
            return Err(Error::EscrowNotPending);
        }
        if caller != escrow.depositor {
            return Err(Error::NotDepositor);
        }

        let now = env.ledger().timestamp();
        if escrow.dispute_window == 0 || now > escrow.created_at + escrow.dispute_window {
            return Err(Error::DisputeWindowClosed);
        }

        escrow.status = EscrowStatus::Disputed;
        escrow.dispute_raised_at = Some(now);
        Self::save_escrow(&env, &escrow);

        env.events().publish(
            (symbol_short!("disputed"), escrow_id),
            (escrow.depositor, now),
        );
        Ok(())
    }

    /// Resolve a dispute as the admin.
    ///
    /// * `release_to_beneficiary` — when `true`, funds (minus fees) are sent to
    ///   the beneficiary; when `false`, funds are returned to the depositor.
    pub fn resolve_dispute(
        env: Env,
        caller: Address,
        escrow_id: String,
        release_to_beneficiary: bool,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut escrow = Self::load_escrow(&env, &escrow_id)?;
        if escrow.status != EscrowStatus::Disputed {
            return Err(Error::EscrowNotDisputed);
        }

        let now = env.ledger().timestamp();
        let token_client = token::Client::new(&env, &escrow.payment_token);

        if release_to_beneficiary {
            // Transfer the fee, if any
            if escrow.fee_amount > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.fee_recipient,
                    &escrow.fee_amount,
                );
            }
            let beneficiary_amount = escrow.amount - escrow.fee_amount;
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.beneficiary,
                &beneficiary_amount,
            );
            escrow.status = EscrowStatus::Released;
        } else {
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.depositor,
                &escrow.amount,
            );
            escrow.status = EscrowStatus::Refunded;
        }

        escrow.resolved_at = Some(now);
        Self::save_escrow(&env, &escrow);

        env.events().publish(
            (symbol_short!("resolved"), escrow_id),
            (caller, release_to_beneficiary, escrow.resolved_at.unwrap()),
        );
        Ok(())
    }

    // ── Public getters ────────────────────────────────────────────────────────

    /// Return the contract administrator.
    pub fn admin(env: Env) -> Result<Address, Error> {
        Self::get_admin(&env)
    }

    /// Return the accepted payment token.
    pub fn payment_token(env: Env) -> Result<Address, Error> {
        Self::get_payment_token(&env)
    }

    /// Return the default dispute window.
    pub fn dispute_window(env: Env) -> u64 {
        Self::get_dispute_window(&env)
    }

    /// Return the default fee recipient.
    pub fn fee_recipient(env: Env) -> Result<Address, Error> {
        Self::get_fee_recipient(&env)
    }

    /// Return the default fee basis points.
    pub fn fee_bps(env: Env) -> u32 {
        Self::get_fee_bps(&env)
    }

    /// Fetch an escrow by ID.
    pub fn get_escrow(env: Env, escrow_id: String) -> Result<Escrow, Error> {
        Self::load_escrow(&env, &escrow_id)
    }

    /// List escrow IDs for a depositor.
    pub fn get_depositor_escrows(env: Env, depositor: Address) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::DepositorEscrows(depositor))
            .unwrap_or(Vec::new(&env))
    }

    /// List escrow IDs for a beneficiary.
    pub fn get_beneficiary_escrows(env: Env, beneficiary: Address) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::BeneficiaryEscrows(beneficiary))
            .unwrap_or(Vec::new(&env))
    }
}
