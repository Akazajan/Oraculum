#![no_std]
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
};

#[contract]
pub struct MembershipTokenContract;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MembershipStatus {
    Active,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MembershipToken {
    pub id: BytesN<32>,
    pub user: Address,
    pub status: MembershipStatus,
    pub issue_date: u64,
    pub expiry_date: u64,
}

#[contracttype]
pub enum DataKey {
    Token(BytesN<32>),
    Admin,
    /// Identity → the membership token that identity currently holds.
    ///
    /// Backs the "one active membership per identity" guarantee: issuance
    /// refuses to mint a second token for an identity that already appears
    /// here, and transfers move the entry so it never goes stale.
    UserToken(Address),
    /// Membership token → an address the owner has authorised to transfer it.
    Approval(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AdminNotSet = 1,
    TokenAlreadyIssued = 2,
    InvalidExpiryDate = 3,
    TokenNotFound = 4,
    TokenExpired = 5,
    /// The identity already holds a membership token.
    UserAlreadyHasToken = 6,
    /// The caller is neither the current owner nor an approved authority.
    Unauthorized = 7,
    /// The recipient is already the owner of this token.
    SelfTransfer = 8,
}

#[contractimpl]
impl MembershipTokenContract {
    // ── Internal helpers ──────────────────────────────────────────────────────

    fn load_token(env: &Env, id: &BytesN<32>) -> Result<MembershipToken, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Token(id.clone()))
            .ok_or(Error::TokenNotFound)
    }

    /// The token currently held by `user`, if any.
    fn token_of(env: &Env, user: &Address) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::UserToken(user.clone()))
    }

    /// `true` when `user` already holds a membership token.
    ///
    /// A dangling index entry (token removed but index left behind) is treated
    /// as "no membership" so a stale key can never permanently lock an
    /// identity out of the contract.
    fn holds_membership(env: &Env, user: &Address) -> bool {
        match Self::token_of(env, user) {
            Some(id) => env.storage().persistent().has(&DataKey::Token(id)),
            None => false,
        }
    }

    /// Authorise `caller` to act on `token`.
    ///
    /// Accepts the current owner, or an address the owner has registered via
    /// [`Self::approve_transfer`]. Auth is only required after the caller has
    /// been matched, so an unauthorised address is rejected outright rather
    /// than prompted for a signature.
    fn require_owner_or_approved(
        env: &Env,
        token: &MembershipToken,
        caller: &Address,
    ) -> Result<(), Error> {
        if caller == &token.user {
            caller.require_auth();
            return Ok(());
        }

        let approved: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approval(token.id.clone()));

        match approved {
            Some(approved) if &approved == caller => {
                caller.require_auth();
                Ok(())
            }
            _ => Err(Error::Unauthorized),
        }
    }

    // ── Issuance ──────────────────────────────────────────────────────────────

    /// Mint a membership token for `user`.
    ///
    /// Every validation runs before the first storage write, so a rejected
    /// issuance leaves token state exactly as it was.
    pub fn issue_token(
        env: Env,
        id: BytesN<32>,
        user: Address,
        expiry_date: u64,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AdminNotSet)?;
        admin.require_auth();

        if env.storage().persistent().has(&DataKey::Token(id.clone())) {
            return Err(Error::TokenAlreadyIssued);
        }

        // One active membership per identity: a second token for an identity
        // that already holds one would break the uniqueness the contract
        // promises, even though its token id differs.
        if Self::holds_membership(&env, &user) {
            return Err(Error::UserAlreadyHasToken);
        }

        let current_time = env.ledger().timestamp();
        if expiry_date <= current_time {
            return Err(Error::InvalidExpiryDate);
        }

        let token = MembershipToken {
            id: id.clone(),
            user: user.clone(),
            status: MembershipStatus::Active,
            issue_date: current_time,
            expiry_date,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Token(id.clone()), &token);
        // Record ownership so the uniqueness check above sees this token.
        env.storage()
            .persistent()
            .set(&DataKey::UserToken(user.clone()), &id);

        env.events()
            .publish((symbol_short!("token_iss"), id, user), current_time);

        Ok(())
    }

    // ── Transfer authorisation ────────────────────────────────────────────────

    /// Authorise `approved` to transfer the membership token `id`.
    ///
    /// Only the current owner may set this, and the approval is cleared on
    /// every successful transfer so it never carries over to a new owner.
    pub fn approve_transfer(env: Env, id: BytesN<32>, approved: Address) -> Result<(), Error> {
        let token = Self::load_token(&env, &id)?;
        token.user.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::Approval(id.clone()), &approved);

        env.events()
            .publish((symbol_short!("token_apr"), id), (token.user, approved));

        Ok(())
    }

    /// Revoke any transfer approval on the membership token `id`.
    pub fn revoke_approval(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let token = Self::load_token(&env, &id)?;
        token.user.require_auth();

        env.storage().persistent().remove(&DataKey::Approval(id));

        Ok(())
    }

    /// Return the address approved to transfer `id`, if any.
    pub fn get_approved(env: Env, id: BytesN<32>) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Approval(id))
    }

    /// Transfer the membership token `id` to `new_user`.
    ///
    /// `caller` must be the current owner or an address the owner approved.
    /// The owner is written exactly once: every check runs first, then the
    /// token, both index entries and the approval are updated together.
    pub fn transfer_token(
        env: Env,
        caller: Address,
        id: BytesN<32>,
        new_user: Address,
    ) -> Result<(), Error> {
        let mut token = Self::load_token(&env, &id)?;

        if token.status != MembershipStatus::Active {
            return Err(Error::TokenExpired);
        }

        Self::require_owner_or_approved(&env, &token, &caller)?;

        let old_user = token.user.clone();

        // A self-transfer would emit a misleading event and rewrite the index
        // for no reason.
        if new_user == old_user {
            return Err(Error::SelfTransfer);
        }

        // Uniqueness must survive transfers as well as issuance.
        if Self::holds_membership(&env, &new_user) {
            return Err(Error::UserAlreadyHasToken);
        }

        token.user = new_user.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Token(id.clone()), &token);

        // Move the identity index with the token.
        env.storage()
            .persistent()
            .remove(&DataKey::UserToken(old_user.clone()));
        env.storage()
            .persistent()
            .set(&DataKey::UserToken(new_user.clone()), &id);

        // An approval is granted by the old owner and must not outlive them.
        env.storage()
            .persistent()
            .remove(&DataKey::Approval(id.clone()));

        env.events().publish(
            (symbol_short!("token_xfr"), id, new_user),
            (old_user, env.ledger().timestamp()),
        );

        Ok(())
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    /// Return the membership token held by `user`, if any.
    pub fn token_of_user(env: Env, user: Address) -> Option<BytesN<32>> {
        Self::token_of(&env, &user)
    }

    pub fn get_token(env: Env, id: BytesN<32>) -> Result<MembershipToken, Error> {
        let mut token = Self::load_token(&env, &id)?;

        let current_time = env.ledger().timestamp();
        if token.status == MembershipStatus::Active && current_time > token.expiry_date {
            token.status = MembershipStatus::Expired;
            env.storage().persistent().set(&DataKey::Token(id), &token);
        }

        Ok(token)
    }

    pub fn set_admin(env: Env, admin: Address) -> Result<(), Error> {
        let existing_admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        match existing_admin {
            Some(current_admin) => {
                current_admin.require_auth();
            }
            None => {
                admin.require_auth();
            }
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }
}
