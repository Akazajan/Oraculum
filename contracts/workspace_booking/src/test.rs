// contracts/workspace_booking/src/test.rs
#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Register the workspace_booking contract and return its address.
fn setup_contract(env: &Env) -> Address {
    env.register(WorkspaceBookingContract, ())
}

/// Register a mock token (Stellar Asset Contract), mint `amount` to `recipient`,
/// and return the token address.
fn setup_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token_address)
        .mock_all_auths()
        .mint(recipient, &amount);
    token_address
}

/// Advance the ledger timestamp by `seconds`.
fn advance_time(env: &Env, seconds: u64) {
    env.ledger().with_mut(|l| l.timestamp += seconds);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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
    client.initialize(&admin, &token); // AlreadyInitialized = 3
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
        &500u128, // 500 units per hour
    );

    let ws = client.get_workspace(&String::from_str(&env, "ws-001"));
    assert_eq!(ws.id, String::from_str(&env, "ws-001"));
    assert_eq!(ws.name, String::from_str(&env, "Hot Desk A"));
    assert_eq!(ws.workspace_type, WorkspaceType::HotDesk);
    assert_eq!(ws.capacity, 1u32);
    assert_eq!(ws.hourly_rate, 500u128);
    assert_eq!(ws.availability, WorkspaceAvailability::Available);
    assert_eq!(ws.created_at, env.ledger().timestamp());

    let all = client.get_all_workspaces();
    assert_eq!(all.len(), 1u32);

    let events = env.events().all();
    assert_eq!(events.len(), 2);
    let registration_event = events.get(1).unwrap();
    assert_eq!(registration_event.1, (symbol_short!("ws_reg"), ws.id));
    assert_eq!(
        registration_event.2,
        (ws.name, ws.workspace_type, ws.capacity, ws.hourly_rate)
    );
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
fn test_register_workspace_duplicate_id_fails_without_mutation_or_event() {
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
    let events_before = env.events().all().len();
    let result = client.try_register_workspace(
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk B"),
        &WorkspaceType::HotDesk,
        &2u32,
        &750u128,
    );

    assert_eq!(result, Err(Ok(Error::WorkspaceAlreadyExists)));
    assert_eq!(env.events().all().len(), events_before);

    let workspace = client.get_workspace(&String::from_str(&env, "ws-001"));
    assert_eq!(workspace.name, String::from_str(&env, "Hot Desk A"));
    assert_eq!(workspace.capacity, 1u32);
    assert_eq!(workspace.hourly_rate, 500u128);
    assert_eq!(client.get_all_workspaces().len(), 1u32);
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
    // Unauthorized = 2
    client.register_workspace(
        &non_admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk A"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Meeting Room Alpha"),
        &WorkspaceType::MeetingRoom,
        &10u32,
        &1_000u128, // 1000 units/hr
    );

    // Book for 2 hours starting 60 seconds from now
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 7_200; // 2 hours

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    let booking = client.get_booking(&String::from_str(&env, "booking-001"));
    assert_eq!(booking.workspace_id, String::from_str(&env, "ws-001"));
    assert_eq!(booking.member, member);
    assert_eq!(booking.status, BookingStatus::Active);
    assert_eq!(booking.amount_paid, 2_000u128); // 2 hrs × 1000

    // Member balance should have decreased
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Desk A"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    // Second booking overlaps — BookingConflict = 102
    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-002"),
        &String::from_str(&env, "ws-001"),
        &(start + 1_800), // starts in the middle of first booking
        &(end + 1_800),
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Private Office"),
        &WorkspaceType::PrivateOffice,
        &4u32,
        &2_000u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600; // 1 hour → cost 2000

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    let balance_after_booking = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_booking, 8_000i128);

    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));

    let balance_after_cancel = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_cancel, 10_000i128); // full refund

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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"),
        &WorkspaceType::HotDesk,
        &1u32,
        &2_000u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600; // 1 hour → cost 2000

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    let balance_after_booking = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_booking, 8_000i128);

    // Advance time to the middle of the booking window.
    advance_time(&env, 60 + 1_800); // now == start + 1800

    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));

    // refund = 2000 * (end - now) / (end - start) = 2000 * 1800 / 3600 = 1000
    let balance_after_cancel = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_cancel, 9_000i128); // 8000 + 1000

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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"),
        &WorkspaceType::HotDesk,
        &1u32,
        &2_000u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    let balance_after_booking = TokenClient::new(&env, &token_address).balance(&member);
    assert_eq!(balance_after_booking, 8_000i128);

    // Advance time past the booking end.
    advance_time(&env, 60 + 3_600 + 10); // now > end

    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));

    // No refund — balance unchanged.
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

    // booking_id far exceeds MAX_ID_LEN (64) → StringTooLong (5)
    let long_id = String::from_str(&env, "b_very_long_booking_id_exceeding_the_max_allowed_length_of_sixty_four_characters");
    client.book_workspace(
        &member,
        &long_id,
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Dedicated Desk"),
        &WorkspaceType::DedicatedDesk,
        &1u32,
        &300u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    // Advance time past end
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    client.cancel_booking(&member, &String::from_str(&env, "booking-001"));
    // BookingAlreadyCancelled = 105
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Hot Desk"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    // Stranger tries to cancel — Unauthorized = 2
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Room B"),
        &WorkspaceType::MeetingRoom,
        &8u32,
        &1_500u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 3_600;
    let end = start + 3_600;

    // No bookings yet — should be available
    assert!(client.check_availability(&String::from_str(&env, "ws-001"), &start, &end));

    // Book it
    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    // Same slot should no longer be available
    assert!(!client.check_availability(&String::from_str(&env, "ws-001"), &start, &end));

    // Non-overlapping slot after the booking should still be available
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Desk C"),
        &WorkspaceType::HotDesk,
        &1u32,
        &400u128,
    );

    // Disable the workspace
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
            &admin,
            &id,
            &String::from_str(&env, "Workspace"),
            &WorkspaceType::HotDesk,
            &1u32,
            &500u128,
        );
    }

    assert_eq!(client.get_all_workspaces().len(), 3u32);

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    // Book ws-001 for the slot
    client.book_workspace(
        &member,
        &String::from_str(&env, "booking-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    // ws-002 and ws-003 should still be available for the same slot
    assert!(client.check_availability(&String::from_str(&env, "ws-002"), &start, &end));
    assert!(client.check_availability(&String::from_str(&env, "ws-003"), &start, &end));
    // ws-001 should NOT be available
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Desk A"),
        &WorkspaceType::DedicatedDesk,
        &1u32,
        &300u128,
    );

    let now = env.ledger().timestamp();

    // Make two non-overlapping bookings for the same member and workspace
    let s1 = now + 100;
    let e1 = s1 + 3_600;
    let s2 = e1 + 600;
    let e2 = s2 + 3_600;

    client.book_workspace(
        &member,
        &String::from_str(&env, "bk-1"),
        &String::from_str(&env, "ws-001"),
        &s1,
        &e1,
    );
    client.book_workspace(
        &member,
        &String::from_str(&env, "bk-2"),
        &String::from_str(&env, "ws-001"),
        &s2,
        &e2,
    );

    assert_eq!(client.get_member_bookings(&member).len(), 2u32);
    assert_eq!(
        client
            .get_workspace_bookings(&String::from_str(&env, "ws-001"))
            .len(),
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
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Office"),
        &WorkspaceType::PrivateOffice,
        &1u32,
        &1_000u128,
    );

    // Update rate to 2000
    client.set_workspace_rate(&admin, &String::from_str(&env, "ws-001"), &2_000u128);

    let ws = client.get_workspace(&String::from_str(&env, "ws-001"));
    assert_eq!(ws.hourly_rate, 2_000u128);

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600; // 1 hour

    client.book_workspace(
        &member,
        &String::from_str(&env, "bk-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    let booking = client.get_booking(&String::from_str(&env, "bk-001"));
    assert_eq!(booking.amount_paid, 2_000u128); // new rate applied
}

// ── FIX #273: Concurrent booking conflict test ──────────────────────────────

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

    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin,
        &String::from_str(&env, "ws-001"),
        &String::from_str(&env, "Meeting Room"),
        &WorkspaceType::MeetingRoom,
        &1u32,
        &1_000u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    // First booking succeeds
    client.book_workspace(
        &member1,
        &String::from_str(&env, "bk-001"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );

    // Second booking for the same slot must fail with BookingConflict
    let result = client.try_book_workspace(
        &member2,
        &String::from_str(&env, "bk-002"),
        &String::from_str(&env, "ws-001"),
        &start,
        &end,
    );
    assert_eq!(result, Err(Ok(Error::BookingConflict)));
}

// ── FIX #248: Regression tests for persistent workspace list storage ────────

#[test]
fn test_get_all_workspaces_persistent_storage() {
    let env = Env::default();
    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token);

    // Verify empty list initially
    let initial_workspaces = client.get_all_workspaces();
    assert_eq!(initial_workspaces.len(), 0u32);

    // Register multiple workspaces to verify persistent accumulation and order
    let ws_ids = ["ws-001", "ws-002", "ws-003", "ws-004", "ws-005"];
    for ws_id in ws_ids.iter() {
        client.register_workspace(
            &admin,
            &String::from_str(&env, ws_id),
            &String::from_str(&env, "Workspace Name"),
            &WorkspaceType::DedicatedDesk,
            &4u32,
            &250u128,
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


// ── C16: Booking state validation ─────────────────────────────────────────────
// Acceptance: invalid discriminants rejected by helper; allowed transitions
// explicit; serialization discriminants remain stable.

#[test]
fn test_c16_invalid_state_cannot_be_constructed() {
    // Only 0..=4 are valid lifecycle discriminants.
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

    // Round-trip through the helper preserves the same variant.
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

    // Terminal states admit no further transitions.
    for terminal in [
        BookingStatus::Completed,
        BookingStatus::Cancelled,
        BookingStatus::NoShow,
        BookingStatus::Expired,
    ] {
        assert!(terminal.is_terminal());
        for to in [
            BookingStatus::Active,
            BookingStatus::Completed,
            BookingStatus::Cancelled,
            BookingStatus::NoShow,
            BookingStatus::Expired,
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
// ── C13: Prevent workspace double booking ─────────────────────────────────────
// Acceptance: overlapping intervals fail; adjacent intervals allowed;
// failed bookings do not transfer funds.

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
        &admin,
        &String::from_str(&env, "ws-c13"),
        &String::from_str(&env, "Conflict Room"),
        &WorkspaceType::MeetingRoom,
        &8u32,
        &1_000u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member1,
        &String::from_str(&env, "c13-bk-1"),
        &String::from_str(&env, "ws-c13"),
        &start,
        &end,
    );

    // Partial overlap: starts mid-slot
    let mid_overlap = client.try_book_workspace(
        &member2,
        &String::from_str(&env, "c13-bk-2"),
        &String::from_str(&env, "ws-c13"),
        &(start + 1_800),
        &(end + 1_800),
    );
    assert_eq!(mid_overlap, Err(Ok(Error::BookingConflict)));

    // Contained overlap: entirely inside existing booking
    let contained = client.try_book_workspace(
        &member2,
        &String::from_str(&env, "c13-bk-3"),
        &String::from_str(&env, "ws-c13"),
        &(start + 600),
        &(end - 600),
    );
    assert_eq!(contained, Err(Ok(Error::BookingConflict)));

    // Covering overlap: spans entire existing booking
    let covering = client.try_book_workspace(
        &member2,
        &String::from_str(&env, "c13-bk-4"),
        &String::from_str(&env, "ws-c13"),
        &(start - 600),
        &(end + 600),
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
        &admin,
        &String::from_str(&env, "ws-adj"),
        &String::from_str(&env, "Adjacent Desk"),
        &WorkspaceType::HotDesk,
        &1u32,
        &500u128,
    );

    let now = env.ledger().timestamp();
    // Leave room before A so an adjacent earlier slot stays in the future.
    let a_start = now + 7_200;
    let a_end = a_start + 3_600;

    client.book_workspace(
        &member1,
        &String::from_str(&env, "adj-a"),
        &String::from_str(&env, "ws-adj"),
        &a_start,
        &a_end,
    );

    // Immediately after A ends (adjacent, not overlapping)
    client.book_workspace(
        &member2,
        &String::from_str(&env, "adj-b"),
        &String::from_str(&env, "ws-adj"),
        &a_end,
        &(a_end + 3_600),
    );

    // Immediately before A starts (adjacent on the other side)
    let member3 = Address::generate(&env);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member3, &50_000i128);

    let before_start = a_start - 3_600;
    assert!(before_start > now);
    client.book_workspace(
        &member3,
        &String::from_str(&env, "adj-c"),
        &String::from_str(&env, "ws-adj"),
        &before_start,
        &a_start,
    );

    assert_eq!(
        client
            .get_workspace_bookings(&String::from_str(&env, "ws-adj"))
            .len(),
        3u32
    );
    assert!(client.check_availability(
        &String::from_str(&env, "ws-adj"),
        &a_end,
        &(a_end + 1),
    ));
}

#[test]
fn test_c13_failed_booking_does_not_transfer_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = setup_contract(&env);
    let client = WorkspaceBookingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member, 50_000i128);
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_address = setup_token(&env, &admin, &member1, 20_000i128);
    StellarAssetClient::new(&env, &token_address)
        .mock_all_auths()
        .mint(&member2, &20_000i128);

    client.initialize(&admin, &token_address);
    client.register_workspace(
        &admin,
        &String::from_str(&env, "ws-c16"),
        &String::from_str(&env, "State Room"),
        &String::from_str(&env, "ws-pay"),
        &String::from_str(&env, "Paid Room"),
        &WorkspaceType::MeetingRoom,
        &4u32,
        &1_000u128,
    );

    let token = TokenClient::new(&env, &token_address);
    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member,
        &String::from_str(&env, "c16-bk-1"),
        &String::from_str(&env, "ws-c16"),
        &start,
        &end,
    );

    let booking = client.get_booking(&String::from_str(&env, "c16-bk-1"));
    assert_eq!(booking.status, BookingStatus::Active);
    assert_eq!(booking.status.as_u32(), 0);

    client.complete_booking(&admin, &String::from_str(&env, "c16-bk-1"));
    let completed = client.get_booking(&String::from_str(&env, "c16-bk-1"));
    assert_eq!(completed.status, BookingStatus::Completed);
    assert!(completed.status.is_terminal());

    // Cancel / no-show / expire from Completed must fail (invalid transition).
    let cancel = client.try_cancel_booking(&member, &String::from_str(&env, "c16-bk-1"));
    assert_eq!(cancel, Err(Ok(Error::BookingNotActive)));

    let noshow = client.try_mark_no_show(&admin, &String::from_str(&env, "c16-bk-1"));
    assert_eq!(noshow, Err(Ok(Error::BookingNotActive)));

    advance_time(&env, 10_000);
    let expire = client.try_expire_booking(&admin, &String::from_str(&env, "c16-bk-1"));
    assert_eq!(expire, Err(Ok(Error::BookingNotActive)));
        &member1,
        &String::from_str(&env, "pay-1"),
        &String::from_str(&env, "ws-pay"),
        &start,
        &end,
    );
    assert_eq!(token.balance(&member1), 19_000i128); // 1hr × 1000

    let balance_before = token.balance(&member2);
    let contract_before = token.balance(&contract_id);

    let result = client.try_book_workspace(
        &member2,
        &String::from_str(&env, "pay-2"),
        &String::from_str(&env, "ws-pay"),
        &(start + 900),
        &(end + 900),
    );
    assert_eq!(result, Err(Ok(Error::BookingConflict)));

    // No funds moved on the failed booking
    assert_eq!(token.balance(&member2), balance_before);
    assert_eq!(token.balance(&contract_id), contract_before);
    // Only the first booking should exist for the workspace
    assert_eq!(
        client
            .get_workspace_bookings(&String::from_str(&env, "ws-pay"))
            .len(),
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
        &admin,
        &String::from_str(&env, "ws-free"),
        &String::from_str(&env, "Rebook Room"),
        &WorkspaceType::PrivateOffice,
        &2u32,
        &2_000u128,
    );

    let now = env.ledger().timestamp();
    let start = now + 60;
    let end = start + 3_600;

    client.book_workspace(
        &member1,
        &String::from_str(&env, "free-1"),
        &String::from_str(&env, "ws-free"),
        &start,
        &end,
    );
    client.cancel_booking(&member1, &String::from_str(&env, "free-1"));

    // Same slot must be bookable again after cancel (inactive bookings ignored)
    client.book_workspace(
        &member2,
        &String::from_str(&env, "free-2"),
        &String::from_str(&env, "ws-free"),
        &start,
        &end,
    );
    let rebooked = client.get_booking(&String::from_str(&env, "free-2"));
    assert_eq!(rebooked.status, BookingStatus::Active);
}
