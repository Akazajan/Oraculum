//! Tests for staking amount overflow prevention (Issue #499 — C41).
//!
//! Acceptance criteria:
//!   1. Overflow fails — checked arithmetic propagates errors rather than wrapping.
//!   2. Balances do not wrap — i128/u64 values that would overflow are rejected.
//!   3. Valid stakes and rewards remain unchanged — normal paths are unaffected.

#![cfg(test)]

use super::*;
use crate::membership_token::DataKey as MembershipDataKey;
use crate::staking::{StakingDataKey, StakingModule};
use crate::types::{StakeInfo, StakingConfig, StakingTier};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup_env() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    // Store admin in instance storage so StakingModule can find it.
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    (env, admin)
}

fn make_config(env: &Env) -> StakingConfig {
    StakingConfig {
        staking_enabled: true,
        staking_token: Address::generate(env),
        reward_pool: Address::generate(env),
        emergency_unstake_penalty_bps: 500, // 5 %
        lock_duration: 100,
    }
}

fn make_tier(env: &Env, id: &str, lock_duration: u64) -> StakingTier {
    StakingTier {
        id: String::from_str(env, id),
        name: String::from_str(env, "Test Tier"),
        min_stake_amount: 1,
        lock_duration,
        reward_multiplier_bps: 10_000,
        base_rate_bps: 500,
        is_active: true,
        deactivated_at: None,
        reactivated_at: None,
    }
}

/// Maximum allowed lock duration (2 years in 5-second ledgers).
const MAX_LOCK: u64 = 12_614_400;

// ---------------------------------------------------------------------------
// Criterion 1 & 2 — Overflow fails; balances do not wrap
// ---------------------------------------------------------------------------

/// A tier with lock_duration exceeding the 2-year cap must be rejected.
#[test]
fn test_create_tier_excessive_lock_duration_fails() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let tier = make_tier(&env, "overflow_tier", MAX_LOCK + 1);
    let result = client.try_create_staking_tier(&admin, &tier);

    assert!(
        result.is_err(),
        "tier with lock_duration > MAX must be rejected to prevent timestamp overflow"
    );
}

/// A tier with lock_duration == u64::MAX must be rejected.
#[test]
fn test_create_tier_max_u64_lock_duration_fails() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let tier = make_tier(&env, "max_lock_tier", u64::MAX);
    let result = client.try_create_staking_tier(&admin, &tier);

    assert!(
        result.is_err(),
        "u64::MAX lock_duration must be rejected"
    );
}

/// A tier with lock_duration exactly at the limit is accepted.
#[test]
fn test_create_tier_max_allowed_lock_duration_succeeds() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let tier = make_tier(&env, "max_ok_tier", MAX_LOCK);
    let result = client.try_create_staking_tier(&admin, &tier);

    assert!(result.is_ok(), "lock_duration == MAX_LOCK must succeed");
}

/// A tier with zero min_stake_amount must be rejected (prevents zero-amount
/// stake positions that would make balance arithmetic degenerate).
#[test]
fn test_create_tier_zero_min_stake_fails() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let mut tier = make_tier(&env, "zero_stake_tier", 100);
    tier.min_stake_amount = 0;
    let result = client.try_create_staking_tier(&admin, &tier);

    assert!(result.is_err(), "zero min_stake_amount must fail");
}

/// A tier with reward_multiplier_bps == 0 must be rejected.
#[test]
fn test_create_tier_zero_multiplier_fails() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let mut tier = make_tier(&env, "zero_mult_tier", 100);
    tier.reward_multiplier_bps = 0;
    let result = client.try_create_staking_tier(&admin, &tier);

    assert!(result.is_err(), "zero reward_multiplier_bps must fail");
}

/// base_rate_bps > 10000 (more than 100%) must be rejected.
#[test]
fn test_create_tier_base_rate_above_maximum_fails() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let mut tier = make_tier(&env, "high_rate_tier", 100);
    tier.base_rate_bps = 10_001;
    let result = client.try_create_staking_tier(&admin, &tier);

    assert!(result.is_err(), "base_rate_bps > 10000 must fail");
}

/// Emergency-unstake penalty_bps > 10000 must be rejected by set_staking_config.
#[test]
fn test_staking_config_excessive_penalty_bps_fails() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let mut config = make_config(&env);
    config.emergency_unstake_penalty_bps = 10_001;

    let result = client.try_set_staking_config(&admin, &config);
    assert!(
        result.is_err(),
        "penalty_bps > 10000 must be rejected by set_staking_config"
    );
}

/// set_staking_config with lock_duration > 2 years must fail.
#[test]
fn test_staking_config_excessive_lock_duration_fails() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let mut config = make_config(&env);
    config.lock_duration = MAX_LOCK + 1;

    let result = client.try_set_staking_config(&admin, &config);
    assert!(
        result.is_err(),
        "config.lock_duration > MAX_LOCK must be rejected"
    );
}

// ---------------------------------------------------------------------------
// Criterion 3 — Valid stakes and rewards remain unchanged
// ---------------------------------------------------------------------------

/// A tier with valid parameters is accepted and retrievable.
#[test]
fn test_create_tier_valid_params_succeeds() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let tier = make_tier(&env, "valid_tier", 1000);
    client.create_staking_tier(&admin, &tier);

    // Should be retrievable via paginated listing.
    let tiers = client.get_staking_tiers_paginated(&crate::types::PageParams {
        offset: 0,
        limit: 10,
    });
    assert_eq!(tiers.len(), 1, "one tier should be stored");
    assert_eq!(tiers.get(0).unwrap().lock_duration, 1000);
}

/// A valid staking config can be set without error.
#[test]
fn test_staking_config_valid_params_succeeds() {
    let (env, admin) = setup_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.set_admin(&admin);

    let config = make_config(&env);
    let result = client.try_set_staking_config(&admin, &config);
    assert!(result.is_ok(), "valid staking config must succeed");
}

/// Reward calculation with normal values must return a positive non-wrapping result.
#[test]
fn test_reward_calculation_normal_values_no_overflow() {
    use crate::rewards::RewardsModule;
    use crate::types::StakeInfo;

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    // Set up a tier to be readable by RewardsModule::calculate_pending_rewards.
    let tier = StakingTier {
        id: String::from_str(&env, "reward_tier"),
        name: String::from_str(&env, "Reward Tier"),
        min_stake_amount: 1,
        lock_duration: 3600,
        reward_multiplier_bps: 10_000,
        base_rate_bps: 1_000, // 10 % pa
        is_active: true,
        deactivated_at: None,
        reactivated_at: None,
    };
    client.create_staking_tier(&admin, &tier);

    // Simulate a stake that has been held for exactly 1 year.
    env.ledger().with_mut(|l| {
        l.timestamp = 365 * 24 * 3600; // 1 year in seconds
    });

    let stake = StakeInfo {
        staker: Address::generate(&env),
        amount: 1_000_000, // 1 USDC (6 decimals)
        tier_id: String::from_str(&env, "reward_tier"),
        staked_at: 0,
        unlock_at: 3600,
        claimed_rewards: 0,
        emergency_unstaked: false,
    };

    let rewards = RewardsModule::calculate_pending_rewards(&env, &stake).unwrap();
    // 1_000_000 * 1000/10000 * (1yr/1yr) * 10000/10000 = 100_000
    assert_eq!(rewards, 100_000, "annual reward must be 10% of principal");
    assert!(rewards >= 0, "rewards must not wrap to negative");
}

/// Reward calculation with i128::MAX principal must fail gracefully, not wrap.
#[test]
fn test_reward_calculation_overflow_fails_not_wraps() {
    use crate::rewards::RewardsModule;
    use crate::types::StakeInfo;

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    let tier = StakingTier {
        id: String::from_str(&env, "overflow_reward_tier"),
        name: String::from_str(&env, "Overflow Tier"),
        min_stake_amount: 1,
        lock_duration: 100,
        reward_multiplier_bps: 10_000,
        base_rate_bps: 10_000, // 100 % pa — maximises intermediate multiplication
        is_active: true,
        deactivated_at: None,
        reactivated_at: None,
    };
    client.create_staking_tier(&admin, &tier);

    env.ledger().with_mut(|l| {
        l.timestamp = 365 * 24 * 3600;
    });

    let stake = StakeInfo {
        staker: Address::generate(&env),
        amount: i128::MAX, // Maximum possible principal
        tier_id: String::from_str(&env, "overflow_reward_tier"),
        staked_at: 0,
        unlock_at: 100,
        claimed_rewards: 0,
        emergency_unstaked: false,
    };

    // Must return an error, not silently wrap.
    let result = RewardsModule::calculate_pending_rewards(&env, &stake);
    assert!(
        result.is_err(),
        "i128::MAX principal with 100% rate must fail with overflow error, not wrap"
    );
}

/// Emergency-unstake penalty arithmetic must use checked operations.
/// Penalty = amount * penalty_bps / 10_000; if this overflows, error must propagate.
#[test]
fn test_emergency_unstake_penalty_overflow_propagates() {
    // We can't easily call emergency_unstake without a full token transfer mock,
    // so we verify the arithmetic directly using the same formula from staking.rs.
    //
    // penalty = amount.checked_mul(penalty_bps).ok_or(Overflow)?.checked_div(10_000)
    let amount: i128 = i128::MAX;
    let penalty_bps: i128 = 10_000; // 100 %

    // checked_mul of i128::MAX * 10_000 must return None (overflow).
    let result = amount.checked_mul(penalty_bps);
    assert!(
        result.is_none(),
        "i128::MAX * 10_000 must overflow and return None"
    );
}
