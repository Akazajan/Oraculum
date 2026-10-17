// contracts/workspace_booking/src/test.rs
#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

// -- Helpers ------------------------------------------------------------------

fn setup_contract(env: &Env) -> Address {
    env.register(WorkspaceBookingContract, ())
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

// -- Tests --------------------------------------------------------------------

#[test]
fn test_initialize_success() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    assert_eq!(client.admin(), admin);
    assert_eq!(client.payment_token(), token);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    client.initialize(&admin, &token);
}

#[test]
fn test_admin_transfer_success_rotates_admin() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    let proposed_at = env.ledger().timestamp();
    client.propose_admin_transfer(&admin, &new_admin);
    let pending = client.get_pending_admin_transfer().unwrap();
    assert_eq!(pending.proposed_admin, new_admin);
    assert_eq!(pending.proposer, admin);
    assert_eq!(pending.expiry, proposed_at + ADMIN_TRANSFER_TTL);
    client.accept_admin_transfer(&new_admin);
    assert_eq!(client.admin(), new_admin);
    assert!(client.get_pending_admin_transfer().is_none());
    let old_admin_result = client.try_register_workspace(
        &admin,
        &String::from_str(&env, "ws-old-admin"),
        &String::from_str(&env, "Old Admin Desk"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );
    assert_eq!(old_admin_result, Err(Ok(Error::Unauthorized)));
    client.register_workspace(
        &new_admin,
        &String::from_str(&env, "ws-new-admin"),
        &String::from_str(&env, "New Admin Desk"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );
}

#[test]
fn test_admin_transfer_rejects_invalid_paths() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let wrong_acceptor = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    let non_admin_result = client.try_propose_admin_transfer(&non_admin, &new_admin);
    assert_eq!(non_admin_result, Err(Ok(Error::Unauthorized)));
    let self_transfer_result = client.try_propose_admin_transfer(&admin, &admin);
    assert_eq!(self_transfer_result, Err(Ok(Error::InvalidAdminTransfer)));
    client.propose_admin_transfer(&admin, &new_admin);
    let wrong_acceptor_result = client.try_accept_admin_transfer(&wrong_acceptor);
    assert_eq!(wrong_acceptor_result, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.admin(), admin);
    assert!(client.get_pending_admin_transfer().is_some());
}

#[test]
fn test_admin_transfer_expiry_and_cancel() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    client.propose_admin_transfer(&admin, &new_admin);
    advance_time(&env, ADMIN_TRANSFER_TTL + 1);
    let expired_result = client.try_accept_admin_transfer(&new_admin);
    assert_eq!(expired_result, Err(Ok(Error::AdminTransferExpired)));
    assert_eq!(client.admin(), admin);
    client.cancel_admin_transfer(&admin);
    assert!(client.get_pending_admin_transfer().is_none());
}

#[test]
fn test_register_workspace_success() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    client.register_workspace(
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk A"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );
    let ws = client.get_workspace(&String::from_str(&env, "ws-001"));
    assert_eq!(ws.name, String::from_str(&env, "Hot Desk A"));
    assert_eq!(ws.workspace_type, WorkspaceType::HotDesk);
    assert_eq!(ws.capacity, 1u32);
    assert_eq!(ws.hourly_rate, 500u128);
    assert_eq!(ws.availability, WorkspaceAvailability::Available);
    let all = client.get_all_workspaces();
    assert_eq!(all.len(), 1u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_register_workspace_name_too_long_fails() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    let oversized_name = "x".repeat((types::MAX_NAME_LEN + 1) as usize);
    client.register_workspace(
        &admin,
        &String::from_str(&env, "ws-oversized-name"),
        &String::from_str(&env, &oversized_name),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #201)")]
fn test_register_workspace_duplicate_id_fails() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk A"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk B"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_register_workspace_non_admin_fails() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    client.register_workspace(
        &non_admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk A"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
}

#[test]
fn test_book_workspace_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Meeting Room Alpha"),
        &WorkspaceType::MeetingRoom, &10u32, &1_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 7_200;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &3u32,
    );
    let booking = client.get_booking(&String::from_str(&env, "booking-001"));
    assert_eq!(booking.workspace_id, String::from_str(&env, "ws-001"));
    assert_eq!(booking.member, member);
    assert_eq!(booking.status, BookingStatus::Active);
    assert_eq!(booking.amount_paid, 2_000u128);
    assert_eq!(booking.seats_requested, 3u32);
    let balance = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance, 10_000 - 2_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #102)")]
fn test_book_workspace_conflict_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Desk A"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    client.book_workspace(
        &member, &String::from_str(&env, "booking-002"),
        &String::from_str(&env, "ws-001"), &(start + 1_800), &(end + 1_800), &1u32,
    );
}

#[test]
fn test_cancel_booking_refunds_member() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Private Office"),
        &WorkspaceType::PrivateOffice, &4u32, &2_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    let balance_after_booking = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_booking, 8_000i128);
    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));
    let balance_after_cancel = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_cancel, 10_000i128);
    let booking = client.get_booking(&String::from_str(&env, "booking-001"));
    assert_eq!(booking.status, BookingStatus::Cancelled);
}

#[test]
fn test_cancel_booking_during_booking_partial_refund() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"), &WorkspaceType::HotDesk, &1u32, &2_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    let balance_after_booking = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_booking, 8_000i128);
    advance_time(&env, 60 + 1_800);
    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));
    let balance_after_cancel = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_cancel, 9_000i128);
    let booking = client.get_booking(&String::from_str(&env, "booking-001"));
    assert_eq!(booking.status, BookingStatus::Cancelled);
}

#[test]
fn test_cancel_booking_after_end_no_refund() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"), &WorkspaceType::HotDesk, &1u32, &2_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    let balance_after_booking = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_booking, 8_000i128);
    advance_time(&env, 60 + 3_600 + 10);
    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));
    let balance_after_cancel = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_cancel, 8_000i128);
    let booking = client.get_booking(&String::from_str(&env, "booking-001"));
    assert_eq!(booking.status, BookingStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_book_workspace_rejects_overlong_ids() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    let long_id = String::from_str(
        &env,
        "b_very_long_booking_id_exceeding_the_max_allowed_length_of_sixty_four_characters",
    );
    client.book_workspace(
        &member, &long_id, &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
}

#[test]
fn test_complete_booking_by_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Dedicated Desk"),
        &WorkspaceType::DedicatedDesk, &1u32, &300u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    advance_time(&env, 4_000);
    client.complete_booking(&admin, &String::from_str(&env, "booking-001"));
    let booking = client.get_booking(&String::from_str(&env, "booking-001"));
    assert_eq!(booking.status, BookingStatus::Completed);
}

#[test]
#[should_panic(expected = "Error(Contract, #105)")]
fn test_cancel_already_cancelled_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));
    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_cancel_booking_unauthorized_caller_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    client.cancel_booking(&stranger, &String::from_str(&env, "booking-001"));
}

#[test]
fn test_check_availability_no_conflict() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Room B"), &WorkspaceType::MeetingRoom, &8u32, &1_500u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 3_600;
    let end = start + 3_600;
    assert!(client.check_availability(&String::from_str(&env, "ws-001"), &start, &end));
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &8u32,
    );
    assert!(!client.check_availability(&String::from_str(&env, "ws-001"), &start, &end));
    assert!(client.check_availability(&String::from_str(&env, "ws-001"), &end, &(end + 3_600)));
}

#[test]
fn test_set_workspace_availability_blocks_new_bookings() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Desk C"), &WorkspaceType::HotDesk, &1u32, &400u128,
    );
    client.set_workspace_availability(&admin, &String::from_str(&env, "ws-001"), &false);
    assert!(!client.check_availability(
        &String::from_str(&env, "ws-001"),
        &(env.ledger().timestamp() + 60),
        &(env.ledger().timestamp() + 3_660)
    ));
}

#[test]
fn test_multiple_workspaces_independent_availability() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    for i in 0u32..3 {
        let id = match i {
            0 => String::from_str(&env, "ws-001"),
            1 => String::from_str(&env, "ws-002"),
            _ => String::from_str(&env, "ws-003"),
        };
        client.register_workspace(
            &admin, &id, &String::from_str(&env, "Workspace"),
            &WorkspaceType::HotDesk, &1u32, &500u128,
        );
    }
    assert_eq!(client.get_all_workspaces().len(), 3u32);
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    assert!(client.check_availability(&String::from_str(&env, "ws-002"), &start, &end));
    assert!(client.check_availability(&String::from_str(&env, "ws-003"), &start, &end));
    assert!(!client.check_availability(&String::from_str(&env, "ws-001"), &start, &end));
}

#[test]
fn test_member_and_workspace_booking_indexes() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Desk A"), &WorkspaceType::DedicatedDesk, &1u32, &300u128,
    );
    let now = env.ledger().timestamp();
    let s1 = now + 100;
    let e1 = s1 + 3_600;
    let s2 = e1 + 600;
    let e2 = s2 + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "bk-1"),
        &String::from_str(&env, "ws-001"), &s1, &e1, &1u32,
    );
    client.book_workspace(
        &member, &String::from_str(&env, "bk-2"),
        &String::from_str(&env, "ws-001"), &s2, &e2, &1u32,
    );
    assert_eq!(client.get_member_bookings(&member).len(), 2u32);
    assert_eq!(
        client.get_workspace_bookings(&String::from_str(&env, "ws-001")).len(),
        2u32
    );
}

#[test]
fn test_hourly_rate_update_applies_to_future_bookings() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Office"), &WorkspaceType::PrivateOffice, &1u32, &1_000u128,
    );
    client.set_workspace_rate(&admin, &String::from_str(&env, "ws-001"), &2_000u128);
    let ws = client.get_workspace(&String::from_str(&env, "ws-001"));
    assert_eq!(ws.hourly_rate, 2_000u128);
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "bk-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    let booking = client.get_booking(&String::from_str(&env, "bk-001"));
    assert_eq!(booking.amount_paid, 2_000u128);
}

#[test]
fn test_concurrent_booking_conflict_same_slot() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 100_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &100_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Meeting Room"), &WorkspaceType::MeetingRoom, &1u32, &1_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "bk-001"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    let result = client.try_book_workspace(
        &member2, &String::from_str(&env, "bk-002"),
        &String::from_str(&env, "ws-001"), &start, &end, &1u32,
    );
    assert_eq!(result, Err(Ok(Error::BookingConflict)));
}

#[test]
fn test_get_all_workspaces_persistent_storage() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    let initial_workspaces = client.get_all_workspaces();
    assert_eq!(initial_workspaces.len(), 0u32);
    let ws_ids = ["ws-001", "ws-002", "ws-003", "ws-004", "ws-005"];
    for ws_id in ws_ids.iter() {
        client.register_workspace(
            &admin, &String::from_str(&env, ws_id),
            &String::from_str(&env, "Workspace Name"),
            &WorkspaceType::DedicatedDesk, &4u32, &250u128,
        );
    }
    let all_workspaces = client.get_all_workspaces();
    assert_eq!(all_workspaces.len(), 5u32);
    for (i, expected_id) in ws_ids.iter().enumerate() {
        assert_eq!(
            all_workspaces.get(i as u32).unwrap(),
            String::from_str(&env, expected_id)
        );
    }
}

// -- C16: Booking state validation -------------------------------------------

#[test]
fn test_c16_invalid_state_cannot_be_constructed() {
    assert!(BookingStatus::try_from_u32(0).is_some());
    assert!(BookingStatus::try_from_u32(4).is_some());
    assert_eq!(BookingStatus::try_from_u32(5), None);
    assert_eq!(BookingStatus::try_from_u32(99), None);
    assert_eq!(BookingStatus::try_from_u32(u32::MAX), None);
}

#[test]
fn test_c16_serialization_discriminants_stable() {
    assert_eq!(BookingStatus::Active.as_u32(), 0);
    assert_eq!(BookingStatus::Completed.as_u32(), 1);
    assert_eq!(BookingStatus::Cancelled.as_u32(), 2);
    assert_eq!(BookingStatus::NoShow.as_u32(), 3);
    assert_eq!(BookingStatus::Expired.as_u32(), 4);
    for d in 0u32..=4 {
        let status = BookingStatus::try_from_u32(d).unwrap();
        assert_eq!(status.as_u32(), d);
    }
}

#[test]
fn test_c16_allowed_transitions_explicit() {
    let active = BookingStatus::initial();
    assert!(active.is_active());
    assert!(!active.is_terminal());
    assert!(active.can_transition(&BookingStatus::Completed));
    assert!(active.can_transition(&BookingStatus::Cancelled));
    assert!(active.can_transition(&BookingStatus::NoShow));
    assert!(active.can_transition(&BookingStatus::Expired));
    assert!(!active.can_transition(&BookingStatus::Active));
    for terminal in [
        BookingStatus::Completed, BookingStatus::Cancelled,
        BookingStatus::NoShow, BookingStatus::Expired,
    ] {
        assert!(terminal.is_terminal());
        for to in [
            BookingStatus::Active, BookingStatus::Completed,
            BookingStatus::Cancelled, BookingStatus::NoShow, BookingStatus::Expired,
        ] {
            assert!(!terminal.can_transition(&to));
            assert!(terminal.transition(to).is_err());
        }
    }
    assert_eq!(
        active.transition(BookingStatus::Cancelled).unwrap(),
        BookingStatus::Cancelled
    );
}

#[test]
fn test_c16_contract_rejects_transition_from_terminal() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-c16"),
        &String::from_str(&env, "State Room"), &WorkspaceType::MeetingRoom, &4u32, &1_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "c16-bk-1"),
        &String::from_str(&env, "ws-c16"), &start, &end, &1u32,
    );
    let booking = client.get_booking(&String::from_str(&env, "c16-bk-1"));
    assert_eq!(booking.status, BookingStatus::Active);
    assert_eq!(booking.status.as_u32(), 0);
    client.complete_booking(&admin, &String::from_str(&env, "c16-bk-1"));
    let completed = client.get_booking(&String::from_str(&env, "c16-bk-1"));
    assert_eq!(completed.status, BookingStatus::Completed);
    assert!(completed.status.is_terminal());
    let cancel = client.try_cancel_booking(&member, &String::from_str(&env, "c16-bk-1"));
    assert_eq!(cancel, Err(Ok(Error::BookingNotActive)));
    let noshow = client.try_mark_no_show(&admin, &String::from_str(&env, "c16-bk-1"));
    assert_eq!(noshow, Err(Ok(Error::BookingNotActive)));
    advance_time(&env, 10_000);
    let expire = client.try_expire_booking(&admin, &String::from_str(&env, "c16-bk-1"));
    assert_eq!(expire, Err(Ok(Error::BookingNotActive)));
}

// -- C13: Prevent workspace double booking -----------------------------------

#[test]
fn test_c13_overlapping_intervals_fail() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 50_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-c13"),
        &String::from_str(&env, "Conflict Room"), &WorkspaceType::MeetingRoom, &1u32, &1_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "c13-bk-1"),
        &String::from_str(&env, "ws-c13"), &start, &end, &1u32,
    );
    let mid_overlap = client.try_book_workspace(
        &member2, &String::from_str(&env, "c13-bk-2"),
        &String::from_str(&env, "ws-c13"), &(start + 1_800), &(end + 1_800), &1u32,
    );
    assert_eq!(mid_overlap, Err(Ok(Error::BookingConflict)));
    let contained = client.try_book_workspace(
        &member2, &String::from_str(&env, "c13-bk-3"),
        &String::from_str(&env, "ws-c13"), &(start + 600), &(end - 600), &1u32,
    );
    assert_eq!(contained, Err(Ok(Error::BookingConflict)));
    let covering = client.try_book_workspace(
        &member2, &String::from_str(&env, "c13-bk-4"),
        &String::from_str(&env, "ws-c13"), &(start - 600), &(end + 600), &1u32,
    );
    assert_eq!(covering, Err(Ok(Error::BookingConflict)));
}

#[test]
fn test_c13_adjacent_intervals_allowed() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 50_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-adj"),
        &String::from_str(&env, "Adjacent Desk"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
    let now = env.ledger().timestamp();
    let a_start = now + 7_200;
    let a_end = a_start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "adj-a"),
        &String::from_str(&env, "ws-adj"), &a_start, &a_end, &1u32,
    );
    client.book_workspace(
        &member2, &String::from_str(&env, "adj-b"),
        &String::from_str(&env, "ws-adj"), &a_end, &(a_end + 3_600), &1u32,
    );
    let member3 = Address::generate(&env);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member3, &50_000i128);
    let before_start = a_start - 3_600;
    assert!(before_start > now);
    client.book_workspace(
        &member3, &String::from_str(&env, "adj-c"),
        &String::from_str(&env, "ws-adj"), &before_start, &a_start, &1u32,
    );
    assert_eq!(
        client.get_workspace_bookings(&String::from_str(&env, "ws-adj")).len(),
        3u32
    );
    assert!(client.check_availability(
        &String::from_str(&env, "ws-adj"), &a_end, &(a_end + 1),
    ));
}

#[test]
fn test_c13_failed_booking_does_not_transfer_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 20_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &20_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-pay"),
        &String::from_str(&env, "Paid Room"), &WorkspaceType::MeetingRoom, &1u32, &1_000u128,
    );
    let token = TokenClient::new(&env, &token_address);
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "pay-1"),
        &String::from_str(&env, "ws-pay"), &start, &end, &1u32,
    );
    assert_eq!(token.balance(&member1), 19_000i128);
    let balance_before = token.balance(&member2);
    let contract_before = token.balance(&contract_id);
    let result = client.try_book_workspace(
        &member2, &String::from_str(&env, "pay-2"),
        &String::from_str(&env, "ws-pay"), &(start + 900), &(end + 900), &1u32,
    );
    assert_eq!(result, Err(Ok(Error::BookingConflict)));
    assert_eq!(token.balance(&member2), balance_before);
    assert_eq!(token.balance(&contract_id), contract_before);
    assert_eq!(
        client.get_workspace_bookings(&String::from_str(&env, "ws-pay")).len(),
        1u32
    );
}

#[test]
fn test_c13_cancelled_booking_frees_slot_for_rebook() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 20_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &20_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-free"),
        &String::from_str(&env, "Rebook Room"), &WorkspaceType::PrivateOffice, &1u32, &2_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "free-1"),
        &String::from_str(&env, "ws-free"), &start, &end, &1u32,
    );
    client.cancel_booking(&member1, &String::from_str(&env, "free-1"));
    client.book_workspace(
        &member2, &String::from_str(&env, "free-2"),
        &String::from_str(&env, "ws-free"), &start, &end, &1u32,
    );
    let rebooked = client.get_booking(&String::from_str(&env, "free-2"));
    assert_eq!(rebooked.status, BookingStatus::Active);
}

#[test]
fn test_active_index_shrinks_after_cancel_and_slot_reopens() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 100_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-idx"),
        &String::from_str(&env, "Index Room"), &WorkspaceType::HotDesk, &1u32, &100u128,
    );
    let workspace_id = String::from_str(&env, "ws-idx");
    let now = env.ledger().timestamp();
    let start = now + 100;
    let end = start + 200;
    let booking_id = String::from_str(&env, "b1");
    client.book_workspace(&member, &booking_id, &workspace_id, &start, &end, &1u32);
    assert!(!client.check_availability(&workspace_id, &start, &end));
    client.cancel_booking(&admin, &booking_id);
    let active = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .get::<_, soroban_sdk::Vec<String>>(
                &DataKey::ActiveWorkspaceBookings(workspace_id.clone()),
            )
            .unwrap_or(soroban_sdk::Vec::new(&env))
    });
    assert_eq!(active.len(), 0);
    assert!(client.check_availability(&workspace_id, &start, &end));
    let history = client.get_workspace_bookings(&workspace_id);
    assert_eq!(history.len(), 1);
}

#[test]
fn test_is_slot_available_ignores_terminal_bookings_after_many_cycles() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 500_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-cycle"),
        &String::from_str(&env, "Cycle Room"), &WorkspaceType::HotDesk, &1u32, &100u128,
    );
    let workspace_id = String::from_str(&env, "ws-cycle");
    let now = env.ledger().timestamp();
    for i in 0..5u32 {
        let id = String::from_str(&env, &soroban_sdk::format!(env, "hist-{}", i));
        let start = now + 1_000 + (i as u64) * 500;
        let end = start + 100;
        client.book_workspace(&member, &id, &workspace_id, &start, &end, &1u32);
        client.cancel_booking(&admin, &id);
    }
    let active = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .get::<_, soroban_sdk::Vec<String>>(
                &DataKey::ActiveWorkspaceBookings(workspace_id.clone()),
            )
            .unwrap_or(soroban_sdk::Vec::new(&env))
    });
    assert_eq!(active.len(), 0, "active index must not accumulate terminal bookings");
    let new_start = now + 1_000;
    let new_end = new_start + 100;
    let new_id = String::from_str(&env, "fresh");
    client.book_workspace(&member, &new_id, &workspace_id, &new_start, &new_end, &1u32);
    let active_after = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .get::<_, soroban_sdk::Vec<String>>(
                &DataKey::ActiveWorkspaceBookings(workspace_id.clone()),
            )
            .unwrap_or(soroban_sdk::Vec::new(&env))
    });
    assert_eq!(active_after.len(), 1);
}

// -- Capacity and seat-count validation tests (new) ---------------------------

/// AC3: Creating a workspace with zero capacity must fail (InvalidCapacity = 6).
#[test]
fn test_register_workspace_zero_capacity_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    let result = client.try_register_workspace(
        &admin, &String::from_str(&env, "ws-zero-cap"),
        &String::from_str(&env, "Zero Cap Desk"), &WorkspaceType::HotDesk, &0u32, &500u128,
    );
    assert_eq!(result, Err(Ok(Error::InvalidCapacity)));
    let fetch = client.try_get_workspace(&String::from_str(&env, "ws-zero-cap"));
    assert_eq!(fetch, Err(Ok(Error::WorkspaceNotFound)));
}

/// AC1: A booking request with zero seats must fail (InvalidSeatCount = 108).
#[test]
fn test_book_workspace_zero_seats_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-cap"),
        &String::from_str(&env, "Cap Room"), &WorkspaceType::MeetingRoom, &10u32, &1_000u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    let result = client.try_book_workspace(
        &member, &String::from_str(&env, "bk-zero-seats"),
        &String::from_str(&env, "ws-cap"), &start, &end, &0u32,
    );
    assert_eq!(result, Err(Ok(Error::InvalidSeatCount)));
}

/// AC2: A booking request exceeding the workspace total capacity must fail (CapacityExceeded = 109).
#[test]
fn test_book_workspace_exceeds_total_capacity_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-small"),
        &String::from_str(&env, "Small Room"), &WorkspaceType::MeetingRoom, &5u32, &500u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    let result = client.try_book_workspace(
        &member, &String::from_str(&env, "bk-over-cap"),
        &String::from_str(&env, "ws-small"), &start, &end, &6u32,
    );
    assert_eq!(result, Err(Ok(Error::CapacityExceeded)));
}

/// AC4 (boundary): Booking exactly the total capacity succeeds.
#[test]
fn test_book_workspace_exact_capacity_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 100_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-exact"),
        &String::from_str(&env, "Exact Room"), &WorkspaceType::MeetingRoom, &8u32, &200u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "bk-exact"),
        &String::from_str(&env, "ws-exact"), &start, &end, &8u32,
    );
    let booking = client.get_booking(&String::from_str(&env, "bk-exact"));
    assert_eq!(booking.seats_requested, 8u32);
    assert_eq!(booking.status, BookingStatus::Active);
}

/// AC5 (remaining-capacity boundary): A booking using exactly the remaining seats succeeds.
#[test]
fn test_book_workspace_exact_remaining_capacity_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 100_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &100_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-remain"),
        &String::from_str(&env, "Remain Room"), &WorkspaceType::MeetingRoom, &10u32, &100u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "bk-rem-1"),
        &String::from_str(&env, "ws-remain"), &start, &end, &7u32,
    );
    client.book_workspace(
        &member2, &String::from_str(&env, "bk-rem-2"),
        &String::from_str(&env, "ws-remain"), &start, &end, &3u32,
    );
    let b2 = client.get_booking(&String::from_str(&env, "bk-rem-2"));
    assert_eq!(b2.seats_requested, 3u32);
    assert_eq!(b2.status, BookingStatus::Active);
}

/// AC6: A request for even one seat beyond the remaining capacity fails.
#[test]
fn test_book_workspace_one_over_remaining_capacity_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 100_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &100_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-over"),
        &String::from_str(&env, "Over Room"), &WorkspaceType::MeetingRoom, &4u32, &100u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "bk-over-1"),
        &String::from_str(&env, "ws-over"), &start, &end, &3u32,
    );
    let result = client.try_book_workspace(
        &member2, &String::from_str(&env, "bk-over-2"),
        &String::from_str(&env, "ws-over"), &start, &end, &2u32,
    );
    assert_eq!(result, Err(Ok(Error::CapacityExceeded)));
}

/// AC7: Once all seats are booked, any further positive-seat booking fails.
#[test]
fn test_book_workspace_capacity_exhausted_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 100_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &100_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-full"),
        &String::from_str(&env, "Full Room"), &WorkspaceType::MeetingRoom, &3u32, &100u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member1, &String::from_str(&env, "bk-full-1"),
        &String::from_str(&env, "ws-full"), &start, &end, &3u32,
    );
    let result = client.try_book_workspace(
        &member2, &String::from_str(&env, "bk-full-2"),
        &String::from_str(&env, "ws-full"), &start, &end, &1u32,
    );
    assert_eq!(result, Err(Ok(Error::CapacityExceeded)));
}

/// AC8 (payment safety): Zero-seat request fails before payment transfer.
#[test]
fn test_invalid_seat_count_does_not_transfer_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-pay-safe"),
        &String::from_str(&env, "Pay Safe Room"), &WorkspaceType::MeetingRoom, &5u32, &1_000u128,
    );
    let token = TokenClient::new(&env, &token_address);
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    let member_balance_before = token.balance(&member);
    let contract_balance_before = token.balance(&contract_id);
    let result = client.try_book_workspace(
        &member, &String::from_str(&env, "bk-pay-safe-0"),
        &String::from_str(&env, "ws-pay-safe"), &start, &end, &0u32,
    );
    assert_eq!(result, Err(Ok(Error::InvalidSeatCount)));
    assert_eq!(token.balance(&member), member_balance_before);
    assert_eq!(token.balance(&contract_id), contract_balance_before);
}

/// AC8 (payment safety): Over-capacity request fails before payment transfer.
#[test]
fn test_over_capacity_request_does_not_transfer_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-cap-safe"),
        &String::from_str(&env, "Cap Safe Room"), &WorkspaceType::MeetingRoom, &3u32, &500u128,
    );
    let token = TokenClient::new(&env, &token_address);
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    let member_balance_before = token.balance(&member);
    let contract_balance_before = token.balance(&contract_id);
    let result = client.try_book_workspace(
        &member, &String::from_str(&env, "bk-cap-safe"),
        &String::from_str(&env, "ws-cap-safe"), &start, &end, &4u32,
    );
    assert_eq!(result, Err(Ok(Error::CapacityExceeded)));
    assert_eq!(token.balance(&member), member_balance_before);
    assert_eq!(token.balance(&contract_id), contract_balance_before);
}

/// Smallest valid seat count (1) succeeds when capacity is 1.
#[test]
fn test_book_workspace_minimum_valid_seats() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 10_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-min"),
        &String::from_str(&env, "Min Desk"), &WorkspaceType::HotDesk, &1u32, &500u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &member, &String::from_str(&env, "bk-min"),
        &String::from_str(&env, "ws-min"), &start, &end, &1u32,
    );
    let booking = client.get_booking(&String::from_str(&env, "bk-min"));
    assert_eq!(booking.seats_requested, 1u32);
    assert_eq!(booking.status, BookingStatus::Active);
}

/// Multiple partial seat bookings accumulate; over-booking fails; final remaining seat succeeds.
#[test]
fn test_partial_seat_bookings_accumulate_and_fail_when_full() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &m1, 100_000i128);
    StellarAssetClient::new(&env, &token_address).mock_all_auths().mint(&m2, &100_000i128);
    StellarAssetClient::new(&env, &token_address).mock_all_auths().mint(&m3, &100_000i128);
    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin, &String::from_str(&env, "ws-multi"),
        &String::from_str(&env, "Multi Room"), &WorkspaceType::MeetingRoom, &6u32, &100u128,
    );
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;
    client.book_workspace(
        &m1, &String::from_str(&env, "bk-m1"),
        &String::from_str(&env, "ws-multi"), &start, &end, &3u32,
    );
    client.book_workspace(
        &m2, &String::from_str(&env, "bk-m2"),
        &String::from_str(&env, "ws-multi"), &start, &end, &2u32,
    );
    let result = client.try_book_workspace(
        &m3, &String::from_str(&env, "bk-m3"),
        &String::from_str(&env, "ws-multi"), &start, &end, &2u32,
    );
    assert_eq!(result, Err(Ok(Error::CapacityExceeded)));
    client.book_workspace(
        &m3, &String::from_str(&env, "bk-m3-ok"),
        &String::from_str(&env, "ws-multi"), &start, &end, &1u32,
    );
    let final_result = client.try_book_workspace(
        &m1, &String::from_str(&env, "bk-m1-extra"),
        &String::from_str(&env, "ws-multi"), &start, &end, &1u32,
    );
    assert_eq!(final_result, Err(Ok(Error::CapacityExceeded)));
}
