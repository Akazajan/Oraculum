#![no_std]
#![allow(deprecated)]

use soroban_sdk{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,},
;

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
    /// Identity �+' the membership token that identity currently holds.
    ///
    /// Backs the "one active membership per identity" guarantee: issuance
    /// refuses to mint a second token for an identity that already appears
    /// here, and transfers move the entry so it never goes stale.
    /// Expired tokens may still appear here; renewal replaces the entry.
    ///
    /// May contain a stale entry for an identity whose token was transferred
    /// out; repair logic can clear such entries.
    UserToken(Address),
    /// Membership token �+' an address the owner has authorised to transfer it,
    /// with an embedded expiry timestamp (unix ledger timestamp).
    Approval(BytesN<32>, u64),
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
    // �"?�"? Internal helpers �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
    // �"?�"? Internal helpers �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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

    /// `true` when `user` has a membership token (active or expired) stored in the index.
    ///
    /// A dangling index entry (token removed but index left behind) is treated
    /// as "no membership" so a stale key can never permanently lock an
    /// identity out of the contract.  Only tokens with a stored key count.
    fn has_index_entry(env: &Env, user: &Address) -> bool {
        Self::token_of(env, user).is_some()
    }

    /// `true` when `user` holds an active membership token.
    /// `true` when `user` already holds an active membership token.
    ///
    /// A dangling index entry (token removed but index left behind) is treated
    /// as "no membership" so a stale key can never permanently lock an
    /// identity out of the contract.
    fn is_active_member(env: &Env, user: &Address) -> bool {
        match Self::token_of(env, user) {
            Some(id) => {
                let token = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Token(id))
                    .unwrap_or_else(|| {
                        // Index entry exists but token was evicted; treat as no membership
                        env.storage().persistent().remove(&DataKey::UserToken(user.clone()));
                        return false;
                    });
                token.status == MembershipStatus::Active
            }
            None => false,
        }
    }

    /// `true` when `user` has any index entry (active or expired).
    ///
    /// Used by CT-22 to detect and repair stale entries.
    fn has_index_entry(env: &Env, user: &Address) -> bool {
        Self::token_of(env, user).is_some()
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

    // CT-22: Bounded token-owner lookup and index repair
    /// Lookup the token ID held by `user`, if any.
    ///
    /// Returns `Some(id)` if the user has a stored index entry, otherwise `None`.
    /// This is a bounded operation - it only reads the single index entry for
    /// the given user and does not iterate over all tokens.
    pub fn lookup_token_owner(env: Env, user: Address) -> Option<BytesN<32>> {
        Self::token_of(&env, &user)
    }

    /// Repair a stale index entry for `user`.
    ///
    /// CT-22: If the index entry points to a token that no longer exists
    /// (was transferred or expired), this function clears the stale entry,
    /// allowing the identity to receive a new membership token.
    ///
    /// Returns `true` if a stale entry was repaired, `false` if no repair was needed.
    pub fn repair_index(env: Env, user: Address) -> bool {
        // Check if user has an index entry
        if !Self::has_index_entry(&env, &user) {
            return false; // No stale entry to repair
        }

        // Get the token ID from the index
        let token_id = Self::token_of(&env, &user);

        // If token_id is None, something is inconsistent; clear the user entry
        if let Some(id) = token_id {
            // Check if the token still exists and is owned by this user
            let token = env.storage().persistent().get(&DataKey::Token(id.clone()));
            match token {
                Some(_) => {
                    // Token still exists and may still be owned by this user;
                    // no repair needed (the index is consistent)
                    return false;
                }
                None => {
                    // Token no longer exists (was transferred or expired);
                    // clear the stale index entry
                    env.storage()
                        .persistent()
                        .remove(&DataKey::UserToken(user.clone()));
                    return true; // Repaired
                }
            }
        } else {
            // token_id was None, clear stale entry
            env.storage()
                .persistent()
                .remove(&DataKey::UserToken(user.clone()));
            return true; // Repaired
        }

        false
    }

    // CT-21: Enforce unique membership token IDs across transfers
    /// Validate that a token ID is not already in use by checking
    /// that it doesn't already exist in the contract's persistent storage.
    ///
    /// This prevents reissuing a token ID that would overwrite historical
    /// ownership or invalidate the user index.
    fn validate_token_id_not_exists(env: &Env, id: &BytesN<32>) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::Token(id.clone())) {
            return Err(Error::TokenAlreadyIssued);
        }
        Ok(())
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
    ///
    /// Additionally checks that the approval has not expired (compares stored
    /// expiry timestamp against current ledger timestamp).
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
                // Check if approval has expired
                let current_time = env.ledger().timestamp();
                if current_time > approval_expiry {
                    // Approval is expired; remove it and reject
                    env.storage().persistent().remove(&DataKey::Approval(token.id.clone()));
                    return Err(Error::Unauthorized);
                }
                if &approved == caller {
                    caller.require_auth();
                    Ok(())
                } else {
                    Err(Error::Unauthorized)
                }
            }
            None => Err(Error::Unauthorized),
        }
    }

    // �"?�"? Issuance �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
    // �"?�"? Issuance �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    /// Mint a membership token for `user`.
    ///
    /// Every validation runs before the first storage write, so a rejected
    /// issuance leaves token state exactly as it was.
    ///
    /// CT-18: Allows re‑issuance to an identity that already holds an **expired**
    /// membership.  If the identity has no active membership (i.e. `is_active_member`
    /// returns `false`), the issuance succeeds with a new token ID and new expiry.
    /// If the identity already has an active membership, issuance is rejected with
    /// `Error::UserAlreadyHasToken`.
    /// CT-21: Validates that the token ID `id` is not already in use; if it is,
    /// issuance is rejected with `Error::TokenAlreadyIssued`. This prevents
    /// overwriting historical ownership or invalidating the user index.
    ///
    /// CT-22: After successful issuance, repairs any stale index entry for `user`
    /// before recording the new ownership.
    pub fn issue_token(
        env: Env,
        id: BytesN<32>,
        user: Address,
        expiry_date: u64,
    ) -> Result<(), Error> {
        // CT-21: Validate that the token ID is not already in use
        Self::validate_token_id_not_exists(&env, &id)?;

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AdminNotSet)?;
        admin.require_auth();

        if env.storage().persistent().has(&DataKey::Token(id.clone())) {
            return Err(Error::TokenAlreadyIssued);
        }

        // CT-18: Check if user already has an active membership
        // CT-22: Repair any stale index entry for user before recording new ownership
        let _ = Self::repair_index(env.clone(), user.clone());

        // One active membership per identity: a second token for an identity
        // that already holds one would break the uniqueness the contract
        // promises, even though its token id differs.
        if Self::is_active_member(&env, &user) {
            return Err(Error::UserAlreadyHasToken);
        }

        // If user has an expired or no membership, allow re‑issuance
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

    // �"?�"? Transfer authorisation �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
    // �"?�"? Transfer authorisation �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    /// Authorise `caller` to act on `token`.
    ///
    /// Only the current owner may set this, and the approval is cleared on
    /// every successful transfer so it never carries over to a new owner.
    ///
    /// The `ttl` parameter sets a time-to-live (in ledger minutes) for the
    /// approval after which it automatically expires. This implements CT-20:
    /// "Expire transfer approvals automatically".
    pub fn approve_transfer(env: Env, id: BytesN<32>, approved: Address, ttl_minutes: u64) -> Result<(), Error> {
        let token = Self::load_token(&env, &id)?;
        let current_time = env.ledger().timestamp();
        let approval_expiry = current_time + (ttl_minutes * 60); // convert minutes to seconds

        token.user.require_auth();

        // Store approval with expiry timestamp
        env.storage()
            .persistent()
            .set(&DataKey::Approval(token.id.clone(), approval_expiry), &approved);

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

    /// Return the address approved to transfer `id`, if any, and whether it is valid.
    ///
    /// Returns `None` if no approval exists or if the approval has expired.
    /// Implements CT-19: consistent expiry enforcement across operations.
    pub fn get_approved(env: Env, id: BytesN<32>) -> Option<Address> {
        let approved: Option<(Address, u64)> = env
            .storage()
            .persistent()
            .get(&DataKey::Approval(id.clone()));

        match approved {
            Some((addr, approval_expiry)) => {
                let current_time = env.ledger().timestamp();
                if current_time > approval_expiry {
                    // Approval has expired; remove it and return None
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
    /// CT-21: Uniqueness must survive transfers as well as issuance. The transfer
    /// clears the old user's index entry and sets the new user's entry, ensuring
    /// token IDs are unique across the system.
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
        if Self::has_index_entry(&env, &new_user) && !Self::is_active_member(&env, &new_user) {
            // New user has a stale/dangling index entry but no active membership;
            // allow the transfer and clean up the stale entry below.
        }

        token.user = new_user.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Token(id.clone()), &token);

        // Move the identity index with the token.
        env.storage()
            .persistent()
            .remove(&DataKey::UserToken(old_user.clone()));
        // Clean up any stale index entry for the new user
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
            (old_user, env.ledger().timestamp()),
        );

        Ok(())
    }

    // ── Renewal ───────────────────────────────────────────────────────────────

    /// Renew an expired membership for `user` with a new token ID and expiry.
    ///
    /// CT-18: Allows an identity whose membership has expired to receive a new
    /// membership token.  The old token is retired, the index entry is replaced,
    /// and a new active membership is created.
    ///
    /// - `new_id` must be a token ID not already issued in this contract.
    /// - `new_expiry_date` must be in the future (greater than current ledger time).
    /// - The caller must be the current holder of the expired membership, or the admin.
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

        // Check that the new token ID has not already been issued
        if env.storage().persistent().has(&DataKey::Token(new_id.clone())) {
            return Err(Error::TokenAlreadyIssued);
        }

        // Check that the new expiry is in the future
        let current_time = env.ledger().timestamp();
        if new_expiry_date <= current_time {
            return Err(Error::InvalidExpiryDate);
        }

        // Check that the user currently holds an expired (but not active) membership
        let has_active = Self::is_active_member(&env, &user);
        if has_active {
            return Err(Error::UserAlreadyHasToken);
        // CT-21: Uniqueness must survive transfers - ensure new_user doesn't
        // already hold the same token ID (shouldn't happen, but defensive check)
        if Self::has_index_entry(&env, &new_user) {
            // New user already has an index entry; this is fine as long as it's
            // a different token. The transfer will replace the entry.
        }

        // At this point the user either has no index entry or has an expired one;
        // either way we can proceed with renewal.

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
        // Replace the index entry with the new token ID
        env.storage()
            .persistent()
            .set(&DataKey::UserToken(user.clone()), &new_id);

        env.events()
            .publish((symbol_short!("token_renew"), new_id, user), current_time);

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
        if Self::has_index_entry(&env, &new_user) && !Self::is_active_member(&env, &new_user) {
            // New user has a stale index entry but no active membership;
            // allow the transfer and clean up the stale entry below.
        }

        token.user = new_user.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Token(id.clone()), &token);

        // Move the identity index with the token.
        env.storage()
            .persistent()
            .remove(&DataKey::UserToken(old_user.clone()));
        // Clean up any stale index entry for the new user
        // Clear old user's index and set new user's index
        env.storage()
            .persistent()
            .remove(&DataKey::UserToken(new_user.clone()));
        env.storage()
            .persistent()
            .set(&DataKey::UserToken(new_user.clone()), &id);

        // An approval is granted by the old owner and must not outlive them.
        // Clear the approval on transfer (the new owner must set a new one).
        env.storage()
            .persistent()
            .remove(&DataKey::Approval(id.clone()));

        env.events().publish(
            (symbol_short!("token_xfr"), id, new_user),
            (old_user, env.ledger().timestamp()),
        );

        Ok(())
    }

    // �"?�"? Getters �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
    // �"?�"? Getters �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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