#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal, Symbol,
};

use super::{Error, ResourceCreditsContract, ResourceCreditsContractClient};

fn setup() -> (
    Env,
    Address,
    Address,
    ResourceCreditsContractClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ResourceCreditsContract, ());
    let client = ResourceCreditsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, admin, token, client)
}

// ── CT-14: initialize input validation ──────────────────────────────────────

#[test]
fn test_initialize_rejects_token_equal_to_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ResourceCreditsContract, ());
    let client = ResourceCreditsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let result = client.try_initialize(&admin, &admin);
    assert_eq!(result, Err(Ok(Error::InvalidAddress)));
}

#[test]
fn test_initialize_rejects_double_init() {
    let (env, _admin, token, client) = setup();
    let result = client.try_initialize(&Address::generate(&env), &Address::generate(&env));
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
    assert_eq!(client.payment_token(), token);
}

#[test]
fn test_initialize_stores_payment_token() {
    let (_env, _admin, token, client) = setup();
    assert_eq!(client.payment_token(), token);
}

#[test]
fn test_payment_token_uninitialized_returns_not_set() {
    let env = Env::default();
    let contract_id = env.register(ResourceCreditsContract, ());
    let client = ResourceCreditsContractClient::new(&env, &contract_id);
    assert_eq!(
        client.try_payment_token(),
        Err(Ok(Error::PaymentTokenNotSet))
    );
}

// ── spend_credits / total supply ────────────────────────────────────────────

#[test]
fn test_spend_credits_decrements_total_supply() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &1_000u128, &1u64);
    client.spend_credits(&member, &member, &400u128);

    assert_eq!(client.total_supply(), 600u128);
    assert_eq!(client.balance(&member), 600u128);
}

#[test]
fn test_spend_all_credits() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &500u128, &1u64);
    client.spend_credits(&member, &member, &500u128);
    assert_eq!(client.total_supply(), 0u128);
    assert_eq!(client.balance(&member), 0u128);
}

#[test]
fn test_spend_zero_amount_rejected() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &100u128, &1u64);
    let result = client.try_spend_credits(&member, &member, &0u128);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    assert_eq!(client.total_supply(), 100u128);
}

#[test]
fn test_spend_by_non_owner_rejected() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);
    let other = Address::generate(&env);

    client.mint_credits(&admin, &member, &100u128, &1u64);
    let result = client.try_spend_credits(&other, &member, &50u128);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.balance(&member), 100u128);
}

#[test]
fn test_multiple_mints_and_spends() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &300u128, &1u64);
    client.mint_credits(&admin, &member, &200u128, &2u64);
    assert_eq!(client.total_supply(), 500u128);

    client.spend_credits(&member, &member, &150u128);
    client.spend_credits(&member, &member, &100u128);
    assert_eq!(client.total_supply(), 250u128);
    assert_eq!(client.balance(&member), 250u128);
}

// ── mint_credits authorization / overflow ───────────────────────────────────

#[test]
fn test_mint_non_admin_gets_unauthorized_even_with_zero_amount() {
    let (env, _admin, _token, client) = setup();
    let non_admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    let result = client.try_mint_credits(&non_admin, &recipient, &0u128, &1u64);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_mint_non_admin_gets_unauthorized() {
    let (env, _admin, _token, client) = setup();
    let non_admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    let result = client.try_mint_credits(&non_admin, &recipient, &100u128, &1u64);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.total_supply(), 0u128);
    assert_eq!(client.balance(&recipient), 0u128);
    // A rejected mint must not consume the reference.
    assert!(!client.is_issued(&1u64));
}

#[test]
fn test_mint_zero_amount_from_admin_returns_invalid_amount() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    let result = client.try_mint_credits(&admin, &recipient, &0u128, &1u64);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    assert_eq!(client.total_supply(), 0u128);
}

#[test]
fn test_mint_success_updates_supply_and_balance() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    client.mint_credits(&admin, &recipient, &1_000u128, &1u64);
    assert_eq!(client.total_supply(), 1_000u128);
    assert_eq!(client.balance(&recipient), 1_000u128);
}

#[test]
fn test_mint_total_supply_overflow_rejected() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    client.mint_credits(&admin, &recipient, &u128::MAX, &1u64);
    let result = client.try_mint_credits(&admin, &recipient, &1u128, &2u64);
    assert_eq!(result, Err(Ok(Error::Overflow)));
    assert_eq!(client.total_supply(), u128::MAX);
    // The failed mint must not consume its reference.
    assert!(!client.is_issued(&2u64));
}

// ── C32 (#916): duplicate issuance prevention ───────────────────────────────

#[test]
fn test_duplicate_issuance_reference_rejected() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    client.mint_credits(&admin, &recipient, &100u128, &42u64);
    assert!(client.is_issued(&42u64));

    let result = client.try_mint_credits(&admin, &recipient, &100u128, &42u64);
    assert_eq!(result, Err(Ok(Error::DuplicateIssuance)));
    assert_eq!(client.balance(&recipient), 100u128);
    assert_eq!(client.total_supply(), 100u128);
}

#[test]
fn test_duplicate_issuance_rejected_for_different_recipient_and_amount() {
    let (env, admin, _token, client) = setup();
    let first = Address::generate(&env);
    let second = Address::generate(&env);

    client.mint_credits(&admin, &first, &100u128, &7u64);
    let result = client.try_mint_credits(&admin, &second, &999u128, &7u64);
    assert_eq!(result, Err(Ok(Error::DuplicateIssuance)));
    assert_eq!(client.balance(&second), 0u128);
    assert_eq!(client.total_supply(), 100u128);
}

#[test]
fn test_distinct_issuance_references_succeed() {
    let (env, admin, _token, client) = setup();
    let recipient = Address::generate(&env);

    client.mint_credits(&admin, &recipient, &100u128, &1u64);
    client.mint_credits(&admin, &recipient, &100u128, &2u64);
    assert_eq!(client.balance(&recipient), 200u128);
    assert!(client.is_issued(&1u64));
    assert!(client.is_issued(&2u64));
    assert!(!client.is_issued(&3u64));
}

// ── C31 (#915): balances can never go negative ──────────────────────────────

#[test]
fn test_spend_more_than_balance_rejected_without_underflow() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &100u128, &1u64);
    let result = client.try_spend_credits(&member, &member, &101u128);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
    assert_eq!(client.balance(&member), 100u128);
    assert_eq!(client.total_supply(), 100u128);
}

#[test]
fn test_spend_from_empty_account_rejected() {
    let (env, _admin, _token, client) = setup();
    let member = Address::generate(&env);

    let result = client.try_spend_credits(&member, &member, &1u128);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
    assert_eq!(client.balance(&member), 0u128);
    assert_eq!(client.total_supply(), 0u128);
}

#[test]
fn test_transfer_more_than_balance_rejected_without_underflow() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &100u128, &1u64);
    let result = client.try_transfer_credits(&from, &from, &to, &u128::MAX);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
    assert_eq!(client.balance(&from), 100u128);
    assert_eq!(client.balance(&to), 0u128);
}

#[test]
fn test_transfer_from_empty_account_rejected() {
    let (env, _admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let result = client.try_transfer_credits(&from, &from, &to, &1u128);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
    assert_eq!(client.balance(&from), 0u128);
    assert_eq!(client.balance(&to), 0u128);
}

// ── transfer_credits ────────────────────────────────────────────────────────

#[test]
fn test_transfer_credits_self_transfer_rejected() {
    let (env, admin, _token, client) = setup();
    let member = Address::generate(&env);

    client.mint_credits(&admin, &member, &1_000u128, &1u64);
    let result = client.try_transfer_credits(&member, &member, &member, &500u128);
    assert_eq!(result, Err(Ok(Error::SelfTransfer)));
    assert_eq!(client.balance(&member), 1_000u128);
}

#[test]
fn test_transfer_credits_success() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &1_000u128, &1u64);
    client.transfer_credits(&from, &from, &to, &300u128);

    assert_eq!(client.balance(&from), 700u128);
    assert_eq!(client.balance(&to), 300u128);
    assert_eq!(client.total_supply(), 1_000u128);
}

#[test]
fn test_transfer_zero_amount_rejected() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &100u128, &1u64);
    let result = client.try_transfer_credits(&from, &from, &to, &0u128);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    assert_eq!(client.balance(&from), 100u128);
}

// ── C33 (#917): transfers require the owner's authorization ─────────────────

#[test]
fn test_transfer_credits_unauthorized_caller_rejected() {
    let (env, admin, _token, client) = setup();
    let owner = Address::generate(&env);
    let other = Address::generate(&env);

    client.mint_credits(&admin, &owner, &500u128, &1u64);
    let result = client.try_transfer_credits(&other, &owner, &other, &100u128);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.balance(&owner), 500u128);
    assert_eq!(client.balance(&other), 0u128);
}

#[test]
fn test_transfer_records_owner_authorization() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &500u128, &1u64);
    client.transfer_credits(&from, &from, &to, &100u128);

    // The only authorization required by the transfer is from the owner.
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (signer, invocation) = &auths[0];
    assert_eq!(signer, &from);
    match &invocation.function {
        AuthorizedFunction::Contract((contract, name, _)) => {
            assert_eq!(contract, &client.address);
            assert_eq!(name, &Symbol::new(&env, "transfer_credits"));
        }
        _ => panic!("expected a contract-function authorization"),
    }
}

#[test]
fn test_transfer_without_owner_signature_rejected() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &500u128, &1u64);

    // Stop mocking auths: no signature is provided for `from`.
    env.set_auths(&[]);
    let result = client.try_transfer_credits(&from, &from, &to, &100u128);
    assert!(result.is_err(), "transfer without owner auth must fail");
    assert_eq!(client.balance(&from), 500u128);
    assert_eq!(client.balance(&to), 0u128);
}

#[test]
fn test_transfer_signed_by_wrong_account_rejected() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let attacker = Address::generate(&env);

    client.mint_credits(&admin, &from, &500u128, &1u64);

    // Only `attacker` signs, while the call claims to act for `from`.
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "transfer_credits",
            args: (from.clone(), from.clone(), to.clone(), 100u128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = client.try_transfer_credits(&from, &from, &to, &100u128);
    assert!(result.is_err(), "transfer signed by a non-owner must fail");
    assert_eq!(client.balance(&from), 500u128);
    assert_eq!(client.balance(&to), 0u128);
}

#[test]
fn test_transfer_with_explicit_owner_signature_succeeds() {
    let (env, admin, _token, client) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint_credits(&admin, &from, &500u128, &1u64);

    env.mock_auths(&[MockAuth {
        address: &from,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "transfer_credits",
            args: (from.clone(), from.clone(), to.clone(), 100u128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.transfer_credits(&from, &from, &to, &100u128);
    assert_eq!(client.balance(&from), 400u128);
    assert_eq!(client.balance(&to), 100u128);
}
