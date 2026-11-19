#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Events, Ledger as _};

#[test]
fn test_transfer_token_emits_event_on_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let old_user = Address::generate(&env);
    let new_user = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[1; 32]);

    client.set_admin(&admin);
    client.issue_token(&token_id, &old_user, &(env.ledger().timestamp() + 1_000));
    let events_before = env.events().all().len();

    client.transfer_token(&old_user, &token_id, &new_user);

    let events = env.events().all();
    assert_eq!(events.len(), events_before + 1);
    let event = events.get(events.len() - 1).unwrap();
    assert_eq!(event.1, (symbol_short!("token_xfr"), token_id, new_user));
    assert_eq!(event.2, (old_user, env.ledger().timestamp()));
}

#[test]
fn test_transfer_token_does_not_emit_event_on_invalid_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let caller = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[2; 32]);
    let new_user = Address::generate(&env);
    let events_before = env.events().all().len();

    assert_eq!(
        client.try_transfer_token(&caller, &token_id, &new_user),
        Err(Ok(Error::TokenNotFound))
    );
    assert_eq!(env.events().all().len(), events_before);
}

#[test]
fn test_renew_token_rejects_non_positive_period() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let new_id = BytesN::from_array(&env, &[9; 32]);

    client.set_admin(&admin);
    assert_eq!(
        client.try_renew_token(&new_id, &user, &env.ledger().timestamp()),
        Err(Ok(Error::InvalidExpiryDate))
    );
}

#[test]
fn test_transfer_token_keeps_ownership_indexes_consistent() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let old_user = Address::generate(&env);
    let new_user = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[7; 32]);

    client.set_admin(&admin);
    client.issue_token(&token_id, &old_user, &(env.ledger().timestamp() + 1_000));
    client.transfer_token(&old_user, &token_id, &new_user);

    assert_eq!(client.get_token(&token_id).user, new_user);
    assert_eq!(client.token_of_user(&new_user), Some(token_id));
    assert_eq!(client.token_of_user(&old_user), None);
}

// ── #921: reject transfers of expired memberships ───────────────────────────

#[test]
fn test_transfer_token_rejects_expired_membership() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let old_user = Address::generate(&env);
    let new_user = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[3; 32]);

    client.set_admin(&admin);
    let expiry = env.ledger().timestamp() + 1_000;
    client.issue_token(&token_id, &old_user, &expiry);

    // Advance past expiry without anyone calling `get_token`, so the stored
    // `status` field is still `Active` - only the ledger timestamp shows the
    // membership has lapsed.
    env.ledger().with_mut(|li| li.timestamp = expiry + 1);

    let result = client.try_transfer_token(&old_user, &token_id, &new_user);
    assert_eq!(result, Err(Ok(Error::TokenExpired)));
    assert_eq!(client.token_of_user(&old_user), Some(token_id));
    assert_eq!(client.token_of_user(&new_user), None);
}

#[test]
fn test_transfer_token_allows_valid_unexpired_membership() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let old_user = Address::generate(&env);
    let new_user = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[4; 32]);

    client.set_admin(&admin);
    let expiry = env.ledger().timestamp() + 1_000;
    client.issue_token(&token_id, &old_user, &expiry);

    client.transfer_token(&old_user, &token_id, &new_user);

    assert_eq!(client.get_token(&token_id).user, new_user);
    assert_eq!(client.token_of_user(&new_user), Some(token_id));
}

// ── #920: enforce transfer authorization ────────────────────────────────────

#[test]
fn test_transfer_token_rejects_unauthorized_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);
    let new_user = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[5; 32]);

    client.set_admin(&admin);
    client.issue_token(&token_id, &owner, &(env.ledger().timestamp() + 1_000));

    // `stranger` is neither the owner nor an approved address.
    let result = client.try_transfer_token(&stranger, &token_id, &new_user);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.token_of_user(&owner), Some(token_id));
    assert_eq!(client.token_of_user(&new_user), None);
}

#[test]
fn test_transfer_token_allows_approved_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let approved = Address::generate(&env);
    let new_user = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[6; 32]);

    client.set_admin(&admin);
    client.issue_token(&token_id, &owner, &(env.ledger().timestamp() + 1_000));
    client.approve_transfer(&token_id, &approved, &60u64);

    client.transfer_token(&approved, &token_id, &new_user);

    assert_eq!(client.get_token(&token_id).user, new_user);
}

// ── #922: prevent duplicate membership token issuance ───────────────────────

#[test]
fn test_issue_token_rejects_duplicate_id() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MembershipTokenContract, ());
    let client = MembershipTokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let original_owner = Address::generate(&env);
    let other_user = Address::generate(&env);
    let token_id = BytesN::from_array(&env, &[8; 32]);

    client.set_admin(&admin);
    client.issue_token(&token_id, &original_owner, &(env.ledger().timestamp() + 1_000));

    // Re-issuing the same id to a different user must fail and must not
    // change the original owner.
    let result = client.try_issue_token(
        &token_id,
        &other_user,
        &(env.ledger().timestamp() + 2_000),
    );
    assert_eq!(result, Err(Ok(Error::TokenAlreadyIssued)));
    assert_eq!(client.get_token(&token_id).user, original_owner);
    assert_eq!(client.token_of_user(&original_owner), Some(token_id));
    assert_eq!(client.token_of_user(&other_user), None);
}
