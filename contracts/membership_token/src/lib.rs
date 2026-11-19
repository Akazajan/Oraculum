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
    /// Identity -> the membership token that identity currently holds.
    ///
    /// Backs the "one active membership per identity" guarantee: issuance
    /// refuses to mint a second token for an identity that already appears
    /// here, and transfers move the entry so it never goes stale.
    ///
    /// May contain a stale entry for an identity whose token was transferred
    /// out; repair logic can clear such entries.
    UserToken(Address),
    /// Membership token -> the address the owner has authorised to transfer
    /// it, paired with the approval's expiry timestamp (unix ledger time).
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
    // ── Internal helpers ─────────────────────────────────────────────────────

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

    /// `true` when `user` holds an active membership token.
    ///
    /// A dangling index entry (token removed but index left behind) is treated
    /// as "no membership" so a stale key can never permanently lock an
    /// identity out of the contract.
    fn is_active_member(env: &Env, user: &Address) -> bool {
        match Self::token_of(env, user) {
            Some(id) => {
                let token: Option<MembershipToken> =
                    env.storage().persistent().get(&DataKey::Token(id));
                match token {
                    Some(token) => {
                        let current_time = env.ledger().timestamp();
                        token.status == MembershipStatus::Active && current_time <= token.expiry_date
                    }
                    None => {
                        // Index entry exists but the token was evicted; treat as no
                        // membership and drop the stale entry.
                        env.storage()
                            .persistent()
                            .remove(&DataKey::UserToken(user.clone()));
                        false
                    }
                }
            }
            None => false,
        }
    }

    /// Authorise `caller` to act on `token`.
    ///
    /// Accepts the current owner, or an address the owner has registered via
    /// [`Self::approve_transfer`] whose approval has not yet expired. Auth is
    /// only required after the caller has been matched, so an unauthorised
    /// address is rejected outright rather than prompted for a signature.
    fn require_owner_or_approved(
        env: &Env,
        token: &MembershipToken,
        caller: &Address,
    ) -> Result<(), Error> {
        if caller == &token.user {
            caller.require_auth();
            return Ok(());
        }

        let approved: Option<(Address, u64)> = env
            .storage()
            .persistent()
            .get(&DataKey::Approval(token.id.clone()));

        match approved {
            Some((approved, approval_expiry)) => {
                let current_time = env.ledger().timestamp();
                if current_time > approval_expiry || &approved != caller {
                    return Err(Error::Unauthorized);
                }
                caller.require_auth();
                Ok(())
            }
            None => Err(Error::Unauthorized),
        }
    }

    // CT-21: Enforce unique membership token IDs across issuance.
    /// Validate that a token ID is not already in use.
    ///
    /// Prevents reissuing a token ID that would overwrite historical
    /// ownership or invalidate the user index.
    fn validate_token_id_not_exists(env: &Env, id: &BytesN<32>) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::Token(id.clone())) {
            return Err(Error::TokenAlreadyIssued);
        }
        Ok(())
    }

    // CT-22: Bounded token-owner lookup and index repair.
    /// Lookup the token ID held by `user`, if any.
    ///
    /// This is a bounded operation - it only reads the single index entry for
    /// the given user and does not iterate over all tokens.
    pub fn lookup_token_owner(env: Env, user: Address) -> Option<BytesN<32>> {
        Self::token_of(&env, &user)
    }

    /// Repair a stale index entry for `user`.
    ///
    /// If the index entry points to a token that no longer exists (was
    /// transferred or expired), this clears the stale entry, allowing the
    /// identity to receive a new membership token.
    ///
    /// Returns `true` if a stale entry was repaired, `false` if no repair was
    /// needed.
    pub fn repair_index(env: Env, user: Address) -> bool {
        match Self::token_of(&env, &user) {
            Some(id) => {
                if env.storage().persistent().has(&DataKey::Token(id)) {
                    false
                } else {
                    env.storage()
                        .persistent()
                        .remove(&DataKey::UserToken(user.clone()));
                    true
                }
            }
            None => false,
        }
    }

    // ── Issuance ─────────────────────────────────────────────────────────────

    /// Mint a membership token for `user`.
    ///
    /// Every validation runs before the first storage write, so a rejected
    /// issuance leaves token state - and the original owner of an already-used
    /// id - exactly as it was.
    ///
    /// CT-18: Allows re-issuance to an identity that already holds an
    /// **expired** membership. If the identity has no active membership
    /// (`is_active_member` returns `false`), issuance succeeds with a new
    /// token ID and new expiry. If the identity already has an active
    /// membership, issuance is rejected with `Error::UserAlreadyHasToken`.
    ///
    /// CT-21: Validates that the token ID `id` is not already in use; if it
    /// is, issuance is rejected with `Error::TokenAlreadyIssued` and the
    /// existing token's owner is left untouched.
    ///
    /// CT-22: After successful issuance, repairs any stale index entry for
    /// `user` before recording the new ownership.
    pub fn issue_token(
        env: Env,
        id: BytesN<32>,
        user: Address,
        expiry_date: u64,
    ) -> Result<(), Error> {
        // CT-21: Validate that the token ID is not already in use.
        Self::validate_token_id_not_exists(&env, &id)?;

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AdminNotSet)?;
        admin.require_auth();

        // CT-22: Repair any stale index entry for user before recording new
        // ownership.
        Self::repair_index(env.clone(), user.clone());

        // One active membership per identity: a second token for an identity
        // that already holds one would break the uniqueness the contract
        // promises, even though its token id differs.
        if Self::is_active_member(&env, &user) {
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
        // Record ownership – this replaces any previous index entry.
        env.storage()
            .persistent()
            .set(&DataKey::UserToken(user.clone()), &id);

        env.events()
            .publish((symbol_short!("token_iss"), id, user), current_time);

        Ok(())
    }

    // ── Renewal ──────────────────────────────────────────────────────────────

    /// Renew an expired membership for `user` with a new token ID and expiry.
    ///
    /// CT-18: Allows an identity whose membership has expired to receive a
    /// new membership token. The index entry is replaced and a new active
    /// membership is created.
    ///
    /// - `new_id` must be a token ID not already issued in this contract.
    /// - `new_expiry_date` must be after the later of the current ledger
    ///   time and the identity's existing expiry.
    /// - The caller must be the admin.
    pub fn renew_token(
        env: Env,
        new_id: BytesN<32>,
        user: Address,
        new_expiry_date: u64,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AdminNotSet)?;
        admin.require_auth();

        // CT-21: the new token ID must not already be in use.
        Self::validate_token_id_not_exists(&env, &new_id)?;

        if Self::is_active_member(&env, &user) {
            return Err(Error::UserAlreadyHasToken);
        }

        // The renewal period must be positive, measured from the later of the
        // current time or the identity's existing expiry.
        let current_time = env.ledger().timestamp();
        let mut base = current_time;
        if let Some(old_id) = Self::token_of(&env, &user) {
            if let Ok(old) = Self::load_token(&env, &old_id) {
                if old.expiry_date > base {
                    base = old.expiry_date;
                }
            }
        }
        if new_expiry_date <= base {
            return Err(Error::InvalidExpiryDate);
        }

        let token = MembershipToken {
            id: new_id.clone(),
            user: user.clone(),
            status: MembershipStatus::Active,
            issue_date: current_time,
            expiry_date: new_expiry_date,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Token(new_id.clone()), &token);
        // Replace the index entry with the new token ID.
        env.storage()
            .persistent()
            .set(&DataKey::UserToken(user.clone()), &new_id);

        env.events()
            .publish((symbol_short!("token_renew"), new_id, user), current_time);

        Ok(())
    }

    // ── Transfer authorisation ───────────────────────────────────────────────

    /// Authorise `approved` to transfer the membership token `id`.
    ///
    /// Only the current owner may set this, and the approval is cleared on
    /// every successful transfer so it never carries over to a new owner.
    ///
    /// `ttl_minutes` sets a time-to-live (in minutes) for the approval, after
    /// which it automatically expires (CT-20).
    pub fn approve_transfer(
        env: Env,
        id: BytesN<32>,
        approved: Address,
        ttl_minutes: u64,
    ) -> Result<(), Error> {
        let token = Self::load_token(&env, &id)?;
        token.user.require_auth();

        let current_time = env.ledger().timestamp();
        let approval_expiry = current_time + (ttl_minutes * 60);

        env.storage()
            .persistent()
            .set(&DataKey::Approval(token.id.clone()), &(approved.clone(), approval_expiry));

        env.events()
            .publish((symbol_short!("token_apr"), id), (token.user, approved));

        Ok(())
    }

    /// Revoke any transfer approval on the membership token `id`.
    pub fn revoke_approval(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let token = Self::load_token(&env, &id)?;
        token.user.require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::Approval(id));

        Ok(())
    }

    /// Return the address approved to transfer `id`, if any and unexpired.
    ///
    /// Returns `None` if no approval exists or if the approval has expired
    /// (CT-19: consistent expiry enforcement across operations).
    pub fn get_approved(env: Env, id: BytesN<32>) -> Option<Address> {
        let approved: Option<(Address, u64)> = env
            .storage()
            .persistent()
            .get(&DataKey::Approval(id.clone()));

        match approved {
            Some((addr, approval_expiry)) => {
                let current_time = env.ledger().timestamp();
                if current_time > approval_expiry {
                    env.storage().persistent().remove(&DataKey::Approval(id));
                    None
                } else {
                    Some(addr)
                }
            }
            None => None,
        }
    }

    /// Transfer the membership token `id` to `new_user`.
    ///
    /// `caller` must be the current owner or an address the owner approved.
    /// The owner is written exactly once: every check runs first, then the
    /// token, both index entries and the approval are updated together.
    ///
    /// Rejects the transfer of a membership that has expired, even when the
    /// stored `status` field has not yet been lazily flipped to `Expired` by
    /// [`Self::get_token`] - expiry is always re-checked against the current
    /// ledger time.
    ///
    /// CT-21: Uniqueness must survive transfers as well as issuance. The
    /// transfer clears the old user's index entry and sets the new user's
    /// entry, ensuring token IDs are unique across the system.
    pub fn transfer_token(
        env: Env,
        caller: Address,
        id: BytesN<32>,
        new_user: Address,
    ) -> Result<(), Error> {
        let mut token = Self::load_token(&env, &id)?;

        let current_time = env.ledger().timestamp();
        if token.status != MembershipStatus::Active || current_time > token.expiry_date {
            return Err(Error::TokenExpired);
        }

        Self::require_owner_or_approved(&env, &token, &caller)?;

        let old_user = token.user.clone();

        // A self-transfer would emit a misleading event and rewrite the index
        // for no reason.
        if new_user == old_user {
            return Err(Error::SelfTransfer);
        }

        token.user = new_user.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Token(id.clone()), &token);

        // Move the identity index with the token; only clear the old owner's
        // entry if it still points at this token.
        if Self::token_of(&env, &old_user) == Some(id.clone()) {
            env.storage()
                .persistent()
                .remove(&DataKey::UserToken(old_user.clone()));
        }
        // Clean up any stale index entry for the new user, then record them
        // as the new owner.
        env.storage()
            .persistent()
            .remove(&DataKey::UserToken(new_user.clone()));
        env.storage()
            .persistent()
            .set(&DataKey::UserToken(new_user.clone()), &id);

        // An approval is granted by the old owner and must not outlive them.
        env.storage()
            .persistent()
            .remove(&DataKey::Approval(id.clone()));

        env.events().publish(
            (symbol_short!("token_xfr"), id, new_user),
            (old_user, current_time),
        );

        Ok(())
    }

    // ── Getters ──────────────────────────────────────────────────────────────

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
            Some(current_admin) => current_admin.require_auth(),
            None => admin.require_auth(),
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }
}

#[cfg(test)]
mod test;
