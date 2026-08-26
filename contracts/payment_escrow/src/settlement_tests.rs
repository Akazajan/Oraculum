// contracts/payment_escrow/src/settlement_tests.rs
#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};
// return Err("Zero-address admin initialization not allowed");
// ── Helpers ───────────────────────────────────────────────────────────────────

const DISPUTE_WINDOW: u64 = 86_400;

fn setup_contract(env: &Env) -> Address {
    env.register(PaymentEscrowContract, ())
}

fn setup_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token_address)
        .mock_all_auths()
        .mint(recipient, &amount);
    token_address
}

fn advance_time(env: &Env, seconds: u64) {
    env.ledger().with_mut(|l| l.timestamp += seconds);
}

fn init<'a>(
    env: &'a Env,
    contract_id: &Address,
    admin: &Address,
    token: &Address,
) -> PaymentEscrowContractClient<'a> {
    let client = PaymentEscrowContractClient::new(env, contract_id);
    client.initialize(admin, token, &DISPUTE_WINDOW);
    client
}

fn esc_id(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_full_settlement_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token = setup_token(&env, &admin, &depositor, 20_000);

    let contract_id = setup_contract(&env);
    let client = init(&env, &contract_id, &admin, &token);

    // Create escrow
    client.create_escrow(
        &depositor,
        &esc_id(&env, "settle-001"),
        &beneficiary,
        &10_000i128,
        &String::from_str(&env, "Booking deposit"),
        &0u64,
    );

    let escrow = client.get_escrow(&esc_id(&env, "settle-001"));
    assert_eq!(escrow.status, EscrowStatus::Pending);

    // Release to beneficiary
    client.resolve_dispute(&admin, &esc_id(&env, "settle-001"), &true);

    let escrow = client.get_escrow(&esc_id(&env, "settle-001"));
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert!(escrow.resolved_at.is_some());

    let beneficiary_bal = TokenClient::new(&env, &token).balance(&beneficiary);
    assert!(beneficiary_bal > 0);
}

#[test]
fn test_disputed_escrow_resolution() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token = setup_token(&env, &admin, &depositor, 20_000);

    let contract_id = setup_contract(&env);
    let client = init(&env, &contract_id, &admin, &token);

    client.create_escrow(
        &depositor,
        &esc_id(&env, "disp-001"),
        &beneficiary,
        &5_000i128,
        &String::from_str(&env, "Damage deposit"),
        &DISPUTE_WINDOW,
    );

    // Dispute
    client.dispute_escrow(&depositor, &esc_id(&env, "disp-001"));
    let escrow = client.get_escrow(&esc_id(&env, "disp-001"));
    assert_eq!(escrow.status, EscrowStatus::Disputed);

    // Resolve in favour of depositor (refund)
    client.resolve_dispute(&admin, &esc_id(&env, "disp-001"), &false);

    let escrow = client.get_escrow(&esc_id(&env, "disp-001"));
    assert_eq!(escrow.status, EscrowStatus::Refunded);

    let depositor_bal = TokenClient::new(&env, &token).balance(&depositor);
    assert!(depositor_bal > 10_000); // refunded portion returned
}

#[test]
fn test_partial_settlement_with_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token = setup_token(&env, &admin, &depositor, 50_000);

    let contract_id = setup_contract(&env);
    let client = PaymentEscrowContractClient::new(&env, &contract_id);
    client.initialize(&admin, &token, &DISPUTE_WINDOW);
    client.set_fee_recipient(&admin, &fee_recipient);
    client.set_fee_bps(&admin, &250u32); // 2.5%

    client.create_escrow(
        &depositor,
        &esc_id(&env, "fee-001"),
        &beneficiary,
        &10_000i128,
        &String::from_str(&env, "Service fee test"),
        &0u64,
    );

    let escrow = client.get_escrow(&esc_id(&env, "fee-001"));
    assert!(escrow.fee_amount > 0);

    // Release and verify fee is deducted
    client.resolve_dispute(&admin, &esc_id(&env, "fee-001"), &true);

    let fee_bal = TokenClient::new(&env, &token).balance(&fee_recipient);
    assert!(fee_bal > 0);

    let beneficiary_bal = TokenClient::new(&env, &token).balance(&beneficiary);
    assert!(beneficiary_bal < 10_000); // less than full amount due to fee
}

#[test]
fn test_multi_escrow_scenario() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token = setup_token(&env, &admin, &depositor, 100_000);

    let contract_id = setup_contract(&env);
    let client = init(&env, &contract_id, &admin, &token);

    // Create three escrows
    for i in 0..3 {
        let id = esc_id(&env, &format!("multi-{}", i));
        client.create_escrow(
            &depositor,
            &id,
            &beneficiary,
            &5_000i128,
            &String::from_str(&env, "Multi test"),
            &0u64,
        );
    }

    // Release first, refund second, dispute third
    client.resolve_dispute(&admin, &esc_id(&env, "multi-0"), &true);
    client.resolve_dispute(&admin, &esc_id(&env, "multi-1"), &false);
    client.dispute_escrow(&depositor, &esc_id(&env, "multi-2"));
    client.resolve_dispute(&admin, &esc_id(&env, "multi-2"), &true);

    assert_eq!(
        client.get_escrow(&esc_id(&env, "multi-0")).status,
        EscrowStatus::Released
    );
    assert_eq!(
        client.get_escrow(&esc_id(&env, "multi-1")).status,
        EscrowStatus::Refunded
    );
    assert_eq!(
        client.get_escrow(&esc_id(&env, "multi-2")).status,
        EscrowStatus::Released
    );
}

#[test]
fn test_auto_claim_after_release_time() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token = setup_token(&env, &admin, &depositor, 20_000);

    let contract_id = setup_contract(&env);
    let client = init(&env, &contract_id, &admin, &token);

    let release_time: u64 = env.ledger().timestamp() + 3600;

    client.create_escrow(
        &depositor,
        &esc_id(&env, "auto-001"),
        &beneficiary,
        &8_000i128,
        &String::from_str(&env, "Auto claim test"),
        &release_time,
    );

    advance_time(&env, 3601);

    client.claim_escrow(&beneficiary, &esc_id(&env, "auto-001"));

    let escrow = client.get_escrow(&esc_id(&env, "auto-001"));
    assert_eq!(escrow.status, EscrowStatus::Released);
}

// ── FIX #271: Full escrow lifecycle integration test ────────────────────────

#[test]
fn test_full_escrow_lifecycle_create_dispute_resolve_to_beneficiary() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let token = setup_token(&env, &admin, &depositor, 50_000);

    let contract_id = setup_contract(&env);
    let client = init(&env, &contract_id, &admin, &token);

    // Set fee config
    client.set_fee_config(&admin, &fee_recipient, &500); // 5% fee

    let amount: i128 = 10_000;

    // Step 1: Create escrow
    let escrow_id = esc_id(&env, "lifecycle-001");
    client.create_escrow(
        &depositor,
        &escrow_id,
        &beneficiary,
        &amount,
        &(DISPUTE_WINDOW + 100),
    );

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Pending);

    // Step 2: Raise dispute
    client.raise_dispute(&depositor, &escrow_id);
    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Disputed);

    // Step 3: Resolve to beneficiary
    client.resolve_dispute(&admin, &escrow_id, &true);
    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);

    // Verify balances
    let fee_amount = amount * 500 / 10_000; // 500
    let beneficiary_amount = amount - fee_amount; // 9500
    assert_eq!(token_client.balance(&beneficiary), beneficiary_amount);
    assert_eq!(token_client.balance(&fee_recipient), fee_amount);
}

#[test]
fn test_full_escrow_lifecycle_create_dispute_resolve_to_depositor() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let token = setup_token(&env, &admin, &depositor, 50_000);

    let contract_id = setup_contract(&env);
    let client = init(&env, &contract_id, &admin, &token);

    client.set_fee_config(&admin, &fee_recipient, &250); // 2.5% fee

    let amount: i128 = 20_000;

    // Create
    let escrow_id = esc_id(&env, "lifecycle-002");
    client.create_escrow(
        &depositor,
        &escrow_id,
        &beneficiary,
        &amount,
        &(DISPUTE_WINDOW + 100),
    );

    // Dispute
    client.raise_dispute(&beneficiary, &escrow_id);

    // Resolve to depositor (refund)
    client.resolve_dispute(&admin, &escrow_id, &false);
    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);

    // Depositor should get full amount back
    // (depositor had 50_000, spent 20_000, got back 20_000 = 50_000)
    assert_eq!(token_client.balance(&depositor), 50_000);
}
