#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use super::{ResourceCreditsContract, ResourceCreditsContractClient};

fn setup() -> (Env, Address, Address, ResourceCreditsContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ResourceCreditsContract);
    let client = ResourceCreditsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, admin, token, client)
}

// ── CT-14: initialize input validation ──────────────────────────────────────

/// Initialize must reject when payment_token == admin, because that would
/// silently misroute all fee payments to the admin address.
#[test]
fn test_initialize_rejects_token_equal_to_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ResourceCreditsContract);
    let client = ResourceCreditsContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    // Passing the admin address as the payment token must fail.
    let result = client.try_initialize(&admin, &admin);
    assert_eq!(result, Err(Ok(super::Error::InvalidAddress)));
}

/// Calling initialize a second time must always fail, regardless of the
/// addresses supplied.
#[test]
fn test_initialize_rejects_double_init() {
    let (env, _admin, token, client) = setup();

    let new_admin = Address::generate(&env);
    let new_token = Address::generate(&env);

    let result = client.try_initialize(&new_admin, &new_token);
    assert_eq!(result, Err(Ok(super::Error::AlreadyInitialized)));

    // Existing config is unchanged.
    assert_eq!(client.payment_token(), token);
}

/// A successful initialization must store and expose the payment token.
#[test]
fn test_initialize_stores_payment_token() {
    let (_env, _admin, token, client) = setup();
    assert_eq!(client.payment_token(), token);
}

/// payment_token() must fail when the contract has not been initialized.
#[test]
fn test_payment_token_uninitialized_returns_not_set() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ResourceCreditsContract);
    let client = ResourceCreditsContractClient::new(&env, &contract_id);

    let result = client.try_payment_token();
    assert_eq!(result, Err(Ok(super::Error::PaymentTokenNotSet)));
}

// ── FIX #272: spend_credits → total_supply decrement test ───────────────────

#[test]
fn test_spend_credits_decrements_total_supply() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    // Mint 1000 credits
    client.mint_credits(&admin, &member, &1_000u128);
    assert_eq!(client.total_supply(), 1_000u128);
    assert_eq!(client.balance(&member), 1_000u128);

    // Spend 400 credits
    client.spend_credits(&member, &member, &400u128);

    // Total supply should decrease by 400
    assert_eq!(client.total_supply(), 600u128);
    assert_eq!(client.balance(&member), 600u128);
}

#[test]
fn test_spend_all_credits() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &500u128);
    assert_eq!(client.total_supply(), 500u128);

    client.spend_credits(&member, &member, &500u128);
    assert_eq!(client.total_supply(), 0u128);
    assert_eq!(client.balance(&member), 0u128);
}

#[test]
fn test_spend_insufficient_balance() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &100u128);
    assert_eq!(client.total_supply(), 100u128);

    let result = client.try_spend_credits(&member, &member, &200u128);
    assert_eq!(result, Err(Ok(super::Error::InsufficientBalance)));
    // Supply should remain unchanged
    assert_eq!(client.total_supply(), 100u128);
}

#[test]
fn test_spend_zero_amount_rejected() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &100u128);

    let result = client.try_spend_credits(&member, &member, &0u128);
    assert_eq!(result, Err(Ok(super::Error::InvalidAmount)));
    assert_eq!(client.total_supply(), 100u128);
}

#[test]
fn test_multiple_mints_and_spends() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    // Mint in two batches
    client.mint_credits(&admin, &member, &300u128);
    client.mint_credits(&admin, &member, &200u128);
    assert_eq!(client.total_supply(), 500u128);

    // Spend partially
    client.spend_credits(&member, &member, &150u128);
    assert_eq!(client.total_supply(), 350u128);

    // Spend again
    client.spend_credits(&member, &member, &100u128);
    assert_eq!(client.total_supply(), 250u128);
    assert_eq!(client.balance(&member), 250u128);
}

// ── FIX #254: mint_credits auth-before-amount reordering ────────────────────

#[test]
fn test_mint_non_admin_gets_unauthorized_even_with_zero_amount() {
    let (env, _admin, _token, client) = setup();
    let non_admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Authorization is checked before amount validation, so a non-admin caller
    // must receive `Unauthorized`, not a descriptive `InvalidAmount`.
    let result = client.try_mint_credits(&non_admin, &recipient, &0u128);
    assert_eq!(result, Err(Ok(super::Error::Unauthorized)));
}

#[test]
fn test_mint_non_admin_gets_unauthorized() {
    let (env, _admin, _token, client) = setup();
    let non_admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    let result = client.try_mint_credits(&non_admin, &recipient, &100u128);
    assert_eq!(result, Err(Ok(super::Error::Unauthorized)));
    assert_eq!(client.total_supply(), 0u128);
    assert_eq!(client.balance(&recipient), 0u128);
}

#[test]
fn test_mint_zero_amount_from_admin_returns_invalid_amount() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    let result = client.try_mint_credits(&admin, &recipient, &0u128);
    assert_eq!(result, Err(Ok(super::Error::InvalidAmount)));
    assert_eq!(client.total_supply(), 0u128);
}

// ── FIX #255: total supply overflow guard when minting large amounts ────────

#[test]
fn test_mint_success_updates_supply_and_balance() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    client.mint_credits(&admin, &recipient, &1_000u128);
    assert_eq!(client.total_supply(), 1_000u128);
    assert_eq!(client.balance(&recipient), 1_000u128);
}

#[test]
fn test_mint_total_supply_overflow_rejected() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    // Fill total supply up to the maximum.
    client.mint_credits(&admin, &recipient, &u128::MAX);
    assert_eq!(client.total_supply(), u128::MAX);

    // A further mint would overflow arithmetic; it must be rejected and leave
    // supply uncorrupted.
    let result = client.try_mint_credits(&admin, &recipient, &1u128);
    assert_eq!(result, Err(Ok(super::Error::Overflow)));
    assert_eq!(client.total_supply(), u128::MAX);
}

// ── transfer_credits self-transfer rejection ───────────────────────────────

#[test]
fn test_transfer_credits_self_transfer_rejected() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &1_000u128);
    assert_eq!(client.balance(&member), 1_000u128);

    let result = client.try_transfer_credits(&member, &member, &member, &500u128);
    assert_eq!(result, Err(Ok(super::Error::SelfTransfer)));
    assert_eq!(client.balance(&member), 1_000u128);
    assert_eq!(client.total_supply(), 1_000u128);
}

#[test]
fn test_transfer_credits_success() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &1_000u128);
    client.transfer_credits(&from, &from, &to, &300u128);

    assert_eq!(client.balance(&from), 700u128);
    assert_eq!(client.balance(&to), 300u128);
    assert_eq!(client.total_supply(), 1_000u128);
}

#[test]
fn test_transfer_credits_unauthorized_caller_rejected() {
    let (env, admin, _token, client) = setup();
    let owner = Address::generate(&env);
    let other = Address::generate(&env);

    client.mint_credits(&admin, &owner, &500u128);

    // `other` tries to transfer from `owner`'s account.
    let result = client.try_transfer_credits(&other, &owner, &other, &100u128);
    assert_eq!(result, Err(Ok(super::Error::Unauthorized)));
    assert_eq!(client.balance(&owner), 500u128);
}

#[test]
fn test_transfer_credits_insufficient_balance_rejected() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &100u128);

    let result = client.try_transfer_credits(&from, &from, &to, &200u128);
    assert_eq!(result, Err(Ok(super::Error::InsufficientBalance)));
    assert_eq!(client.balance(&from), 100u128);
    assert_eq!(client.balance(&to), 0u128);
}

#[test]
fn test_transfer_zero_amount_rejected() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &100u128);

    let result = client.try_transfer_credits(&from, &from, &to, &0u128);
    assert_eq!(result, Err(Ok(super::Error::InvalidAmount)));
    assert_eq!(client.balance(&from), 100u128);
}
