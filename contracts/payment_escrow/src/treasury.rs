// Fee-configuration regression tests for payment escrow.
#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use crate::{Error, PaymentEscrowContract, PaymentEscrowContractClient};

const DISPUTE_WINDOW: u64 = 86_400;
const MAX_FEE_BPS: u32 = 10_000;

fn setup_client<'a>(
    env: &'a Env,
    contract_id: &Address,
    admin: &Address,
    token: &Address,
) -> PaymentEscrowContractClient<'a> {
    env.mock_all_auths();
    let client = PaymentEscrowContractClient::new(env, contract_id);
    client.initialize(admin, token, &DISPUTE_WINDOW, admin, &250u32);
    client
}

#[test]
fn initialize_rejects_fee_above_maximum_without_initializing_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaymentEscrowContract, ());
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let client = PaymentEscrowContractClient::new(&env, &contract_id);

    assert_eq!(
        client.try_initialize(&admin, &token, &DISPUTE_WINDOW, &admin, &(MAX_FEE_BPS + 1)),
        Err(Ok(Error::InvalidFeeBps))
    );

    // A rejected configuration must not partially initialize storage.
    client.initialize(&admin, &token, &DISPUTE_WINDOW, &admin, &250u32);
    assert_eq!(client.fee_bps(), 250);
}

#[test]
fn initialize_accepts_exactly_one_hundred_percent_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaymentEscrowContract, ());
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let client = PaymentEscrowContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token, &DISPUTE_WINDOW, &admin, &MAX_FEE_BPS);
    assert_eq!(client.fee_bps(), MAX_FEE_BPS);
}

#[test]
fn set_fee_bps_rejects_over_limit_and_preserves_existing_configuration() {
    let env = Env::default();
    let contract_id = env.register(PaymentEscrowContract, ());
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let client = setup_client(&env, &contract_id, &admin, &token);

    let original_fee_bps = client.fee_bps();
    assert_eq!(
        client.try_set_fee_bps(&admin, &(MAX_FEE_BPS + 1)),
        Err(Ok(Error::InvalidFeeBps))
    );
    assert_eq!(client.fee_bps(), original_fee_bps);
}

#[test]
fn set_fee_bps_accepts_supported_boundary() {
    let env = Env::default();
    let contract_id = env.register(PaymentEscrowContract, ());
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let client = setup_client(&env, &contract_id, &admin, &token);

    client.set_fee_bps(&admin, &MAX_FEE_BPS);
    assert_eq!(client.fee_bps(), MAX_FEE_BPS);
}
