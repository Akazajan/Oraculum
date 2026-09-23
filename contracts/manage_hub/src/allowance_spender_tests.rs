//! Tests for allowance-spender validation (Issue #507 — C49).
//!
//! Acceptance criteria:
//!   1. Invalid spenders (owner == spender) fail with `InvalidSpender`.
//!   2. Authorized allowances are stored with the requested limit.
//!   3. Allowance creation emits exactly one `Approval` event.

#![cfg(test)]

use super::*;
use crate::allowance::{AllowanceDataKey, AllowanceModule};
use crate::errors::Error;
use crate::membership_token::DataKey as MembershipDataKey;
use crate::types::TokenAllowance;
use soroban_sdk::testutils::{Address as _, BytesN as _, Events};
use soroban_sdk::{Address, BytesN, Env};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn new_token_id(env: &Env) -> BytesN<32> {
    BytesN::<32>::random(env)
}

// ---------------------------------------------------------------------------
// Criterion 1 — Invalid spenders must fail
// ---------------------------------------------------------------------------

/// Owner == spender must be rejected with `InvalidSpender`.
#[test]
fn test_approve_owner_equals_spender_fails() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);

    let result = AllowanceModule::approve(&env, &token_id, &owner, &owner, 100, None);

    assert_eq!(
        result,
        Err(Error::InvalidSpender),
        "owner == spender must return InvalidSpender"
    );
}

/// Zero amount must still fail even for a valid spender.
#[test]
fn test_approve_zero_amount_fails() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let result = AllowanceModule::approve(&env, &token_id, &owner, &spender, 0, None);

    assert_eq!(
        result,
        Err(Error::InvalidPaymentAmount),
        "zero amount must return InvalidPaymentAmount"
    );
}

/// Negative amount must fail.
#[test]
fn test_approve_negative_amount_fails() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let result = AllowanceModule::approve(&env, &token_id, &owner, &spender, -1, None);

    assert_eq!(
        result,
        Err(Error::InvalidPaymentAmount),
        "negative amount must return InvalidPaymentAmount"
    );
}

/// Already-expired timestamp must fail.
#[test]
fn test_approve_expired_timestamp_fails() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    // Ledger timestamp defaults to 0; set it to 1000 so 500 is in the past.
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let result = AllowanceModule::approve(&env, &token_id, &owner, &spender, 50, Some(500));

    assert_eq!(
        result,
        Err(Error::InvalidExpiryDate),
        "past expiry must return InvalidExpiryDate"
    );
}

// ---------------------------------------------------------------------------
// Criterion 2 — Authorized allowances are stored with the requested limit
// ---------------------------------------------------------------------------

/// A valid `approve` call persists the allowance with the exact requested amount.
#[test]
fn test_approve_stores_allowance_with_correct_limit() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let amount: i128 = 500;

    AllowanceModule::approve(&env, &token_id, &owner, &spender, amount, None).unwrap();

    let stored: Option<TokenAllowance> = env.storage().persistent().get(
        &AllowanceDataKey::Allowance(token_id.clone(), owner.clone(), spender.clone()),
    );
    let stored = stored.expect("allowance must be persisted after approve");

    assert_eq!(stored.amount, amount, "stored amount must match requested limit");
    assert_eq!(&stored.owner, &owner, "stored owner must match");
    assert_eq!(&stored.spender, &spender, "stored spender must match");
    assert_eq!(&stored.token_id, &token_id, "stored token_id must match");
    assert_eq!(stored.expires_at, None, "no expiry set");
}

/// A valid `approve` with an expiry stores expiry correctly.
#[test]
fn test_approve_stores_allowance_with_expiry() {
    let env = setup_env();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let expires_at = 2000u64;

    AllowanceModule::approve(&env, &token_id, &owner, &spender, 100, Some(expires_at)).unwrap();

    let stored: TokenAllowance = env
        .storage()
        .persistent()
        .get(&AllowanceDataKey::Allowance(token_id.clone(), owner.clone(), spender.clone()))
        .expect("allowance must be stored");

    assert_eq!(stored.expires_at, Some(expires_at));
    assert_eq!(stored.amount, 100);
}

/// A valid `approve` with a future expiry at exactly ledger + 1 is accepted.
#[test]
fn test_approve_expiry_just_above_now_succeeds() {
    let env = setup_env();
    env.ledger().with_mut(|l| l.timestamp = 500);

    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let result = AllowanceModule::approve(&env, &token_id, &owner, &spender, 10, Some(501));

    assert!(result.is_ok(), "expiry one second ahead must succeed");
}

// ---------------------------------------------------------------------------
// Criterion 3 — Exactly one Approval event per successful call
// ---------------------------------------------------------------------------

/// Successful `approve` emits exactly one event.
#[test]
fn test_approve_emits_exactly_one_event() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    AllowanceModule::approve(&env, &token_id, &owner, &spender, 200, None).unwrap();

    let events = env.events().all();
    // Filter to Approval events for this token/owner/spender triple.
    let approval_events: Vec<_> = events
        .iter()
        .filter(|(_, topics, _)| {
            // topics is a Val-encoded Vec; check the first element is "Approval"
            topics
                .to_string()
                .contains("Approval")
        })
        .collect();

    assert_eq!(
        approval_events.len(),
        1,
        "exactly one Approval event must be emitted per successful approve call"
    );
}

/// Failed `approve` (owner == spender) must not emit any event.
#[test]
fn test_approve_failure_emits_no_event() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);

    let _ = AllowanceModule::approve(&env, &token_id, &owner, &owner, 100, None);

    let events = env.events().all();
    assert_eq!(events.len(), 0, "no event must be emitted on failure");
}

// ---------------------------------------------------------------------------
// Round-trip: approve → get_allowance
// ---------------------------------------------------------------------------

/// `get_allowance` returns the stored allowance immediately after `approve`.
#[test]
fn test_get_allowance_after_approve() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    AllowanceModule::approve(&env, &token_id, &owner, &spender, 750, None).unwrap();

    let fetched = AllowanceModule::get_allowance(&env, &token_id, &owner, &spender);
    assert!(fetched.is_some(), "get_allowance must return Some after approve");
    assert_eq!(fetched.unwrap().amount, 750);
}

/// `get_allowance` for a non-existent allowance returns `None`.
#[test]
fn test_get_allowance_nonexistent_returns_none() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let result = AllowanceModule::get_allowance(&env, &token_id, &owner, &spender);
    assert!(result.is_none(), "no allowance set means None");
}

// ---------------------------------------------------------------------------
// consume_allowance — overspend guard (issue #508 prerequisite)
// ---------------------------------------------------------------------------

/// Consuming more than the allowance must fail.
#[test]
fn test_consume_allowance_overspend_fails() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    AllowanceModule::approve(&env, &token_id, &owner, &spender, 100, None).unwrap();

    let result = AllowanceModule::consume_allowance(&env, &token_id, &owner, &spender, 101);
    assert_eq!(
        result,
        Err(Error::InsufficientBalance),
        "overspend must return InsufficientBalance"
    );
}

/// Consuming exactly the remaining allowance succeeds and clears the record.
#[test]
fn test_consume_allowance_exact_limit_succeeds() {
    let env = setup_env();
    let token_id = new_token_id(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    AllowanceModule::approve(&env, &token_id, &owner, &spender, 100, None).unwrap();
    AllowanceModule::consume_allowance(&env, &token_id, &owner, &spender, 100).unwrap();

    // Allowance record should be removed once fully consumed.
    let remaining = AllowanceModule::get_allowance(&env, &token_id, &owner, &spender);
    assert!(remaining.is_none(), "fully consumed allowance must be removed");
}
