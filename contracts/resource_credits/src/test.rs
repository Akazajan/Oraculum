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
    client.spend_credits(&member, &400u128);

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

    client.spend_credits(&member, &500u128);
    assert_eq!(client.total_supply(), 0u128);
    assert_eq!(client.balance(&member), 0u128);
}

#[test]
fn test_spend_insufficient_balance() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &100u128);
    assert_eq!(client.total_supply(), 100u128);

    let result = client.try_spend_credits(&member, &200u128);
    assert_eq!(result, Err(Ok(super::Error::InsufficientBalance)));
    // Supply should remain unchanged
    assert_eq!(client.total_supply(), 100u128);
}

#[test]
fn test_spend_zero_amount_rejected() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &100u128);

    let result = client.try_spend_credits(&member, &0u128);
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
    client.spend_credits(&member, &150u128);
    assert_eq!(client.total_supply(), 350u128);

    // Spend again
    client.spend_credits(&member, &100u128);
    assert_eq!(client.total_supply(), 250u128);
    assert_eq!(client.balance(&member), 250u128);
}
