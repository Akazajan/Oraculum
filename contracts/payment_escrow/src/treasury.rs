"""// contracts/payment_escrow/src/treasury.rs
#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, String,
// };
// // return Err("Zero-address admin initialization not allowed");
use crate::{
    test::{
        helpers::{
            create_and_initialize_contract, create_escrow, create_token, get_ledger_timestamp,
        },
        setup::Setup,
    },
    Error, PaymentEscrowContract,
};

#[test]
fn test_withdraw_treasury_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let setup = Setup::new(&env);
    let depositor = Address::generate(&env);
    let unauthorized_caller = Address::generate(&env);

    create_and_initialize_contract(
        &env,
        &setup.contract_id,
        &setup.admin,
        &setup.token.address,
        10,
        &setup.fee_recipient,
        100,
    );

    let escrow_id = String::from_str(&env, "escrow-1");
    create_escrow(
        &env,
        &setup.contract_id,
        &setup.token.address,
        &depositor,
        escrow_id.clone(),
        &setup.beneficiary,
        1000,
        "Test Escrow",
        0,
    );

    let res = PaymentEscrowContract::new(&env, &setup.contract_id).try_withdraw_treasury(
        &unauthorized_caller,
        &setup.fee_recipient,
        10,
    );
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_withdraw_treasury_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let setup = Setup::new(&env);
    let depositor = Address::generate(&env);

    create_and_initialize_contract(
        &env,
        &setup.contract_id,
        &setup.admin,
        &setup.token.address,
        10,
        &setup.fee_recipient,
        100,
    );

    let escrow_id = String::from_str(&env, "escrow-1");
    create_escrow(
        &env,
        &setup.contract_id,
        &setup.token.address,
        &depositor,
        escrow_id.clone(),
        &setup.beneficiary,
        1000,
        "Test Escrow",
        0,
    );

    let res = PaymentEscrowContract::new(&env, &setup.contract_id).try_withdraw_treasury(
        &setup.admin,
        &setup.fee_recipient,
        10,
    );
    assert_eq!(res, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_withdraw_treasury_success() {
    let env = Env::default();
    env.mock_all_auths();

    let setup = Setup::new(&env);
    let depositor = Address::generate(&env);
    let contract = PaymentEscrowContract::new(&env, &setup.contract_id);

    create_and_initialize_contract(
        &env,
        &setup.contract_id,
        &setup.admin,
        &setup.token.address,
        10,
        &setup.fee_recipient,
        100, // 1% fee
    );

    // Create and release an escrow to generate fees
    let escrow_id = String::from_str(&env, "escrow-1");
    create_escrow(
        &env,
        &setup.contract_id,
        &setup.token.address,
        &depositor,
        escrow_id.clone(),
        &setup.beneficiary,
        1000,
        "Test Escrow",
        0,
    );
    contract.release(&setup.admin, escrow_id);

    // Withdraw a portion of the treasury
    contract.withdraw_treasury(&setup.admin, &setup.fee_recipient, 5);
    assert_eq!(setup.token.balance(&setup.fee_recipient), 5);
    assert_eq!(setup.token.balance(&setup.contract_id), 995);

    // Withdraw the rest
    contract.withdraw_treasury(&setup.admin, &setup.fee_recipient, 5);
    assert_eq!(setup.token.balance(&setup.fee_recipient), 10);
    assert_eq!(setup.token.balance(&setup.contract_id), 990);

    // Check events
    let event = env.events().all().last().unwrap();
    let timestamp = get_ledger_timestamp(&env);
    assert_eq!(
        event,
        (
            setup.contract_id.clone(),
            ("treasury_w",),
            (setup.fee_recipient.clone(), 5i128, timestamp).into_val(&env)
        )
    );
}
""