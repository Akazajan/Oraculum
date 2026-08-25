// contracts/payment_escrow/src/revenue_split_tests.rs
#![cfg(test)]

use soroban_sdk::{contracttype, testutils::Address as _, Address, Env, Vec};

const TOTAL_BPS: u32 = 10_000;
 /// Funds have been sent to the beneficiary.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
struct SplitEntry {
    recipient: Address,
    bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
struct SplitResult {
    recipient: Address,
    amount: i128,
}

fn calculate_split(
    env: &Env,
    amount: i128,
    splits: &Vec<SplitEntry>,
) -> Result<Vec<SplitResult>, ()> {
    let total_bps: u32 = splits.iter().map(|s| s.bps).sum();
    if total_bps != TOTAL_BPS {
        return Err(());
    }
    if amount <= 0 {
        return Err(());
    }

    let mut results: Vec<SplitResult> = Vec::new(env);
    for entry in splits.iter() {
        let share = (amount * entry.bps as i128) / TOTAL_BPS as i128;
        results.push_back(SplitResult {
            recipient: entry.recipient,
            amount: share,
        });
    }
    Ok(results)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_equal_split() {
    let env = Env::default();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let mut splits: Vec<SplitEntry> = Vec::new(&env);
    splits.push_back(SplitEntry {
        recipient: alice.clone(),
        bps: 5_000,
    });
    splits.push_back(SplitEntry {
        recipient: bob.clone(),
        bps: 5_000,
    });

    let results = calculate_split(&env, 10_000, &splits).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results.get_unchecked(0).amount, 5_000);
    assert_eq!(results.get_unchecked(1).amount, 5_000);
}

#[test]
fn test_unequal_basis_point_split() {
    let env = Env::default();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let mut splits: Vec<SplitEntry> = Vec::new(&env);
    splits.push_back(SplitEntry {
        recipient: alice.clone(),
        bps: 7_000,
    });
    splits.push_back(SplitEntry {
        recipient: bob.clone(),
        bps: 3_000,
    });

    let results = calculate_split(&env, 10_000, &splits).unwrap();
    assert_eq!(results.get_unchecked(0).amount, 7_000);
    assert_eq!(results.get_unchecked(1).amount, 3_000);
}

#[test]
fn test_single_recipient_100_percent() {
    let env = Env::default();
    let alice = Address::generate(&env);

    let mut splits: Vec<SplitEntry> = Vec::new(&env);
    splits.push_back(SplitEntry {
        recipient: alice.clone(),
        bps: 10_000,
    });

    let results = calculate_split(&env, 50_000, &splits).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results.get_unchecked(0).amount, 50_000);
}

#[test]
fn test_rounding_with_10000_total_bps() {
    let env = Env::default();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    // 3333 + 3333 + 3334 = 10000
    let mut splits: Vec<SplitEntry> = Vec::new(&env);
    splits.push_back(SplitEntry {
        recipient: alice.clone(),
        bps: 3_333,
    });
    splits.push_back(SplitEntry {
        recipient: bob.clone(),
        bps: 3_333,
    });
    splits.push_back(SplitEntry {
        recipient: carol.clone(),
        bps: 3_334,
    });

    let results = calculate_split(&env, 10_000, &splits).unwrap();
    // 10000 * 3333 / 10000 = 3333
    assert_eq!(results.get_unchecked(0).amount, 3_333);
    assert_eq!(results.get_unchecked(1).amount, 3_333);
    // 10000 * 3334 / 10000 = 3334
    assert_eq!(results.get_unchecked(2).amount, 3_334);
}

#[test]
fn test_fee_deduction_before_split() {
    let env = Env::default();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    let gross_amount: i128 = 10_000;
    let fee_bps: u32 = 500; // 5%
    let fee = gross_amount * fee_bps as i128 / TOTAL_BPS as i128;
    let net = gross_amount - fee;

    let mut splits: Vec<SplitEntry> = Vec::new(&env);
    splits.push_back(SplitEntry {
        recipient: alice.clone(),
        bps: 6_000,
    });
    splits.push_back(SplitEntry {
        recipient: bob.clone(),
        bps: 4_000,
    });

    let results = calculate_split(&env, net, &splits).unwrap();
    assert_eq!(results.get_unchecked(0).amount, net * 6_000 / TOTAL_BPS as i128);
    assert_eq!(results.get_unchecked(1).amount, net * 4_000 / TOTAL_BPS as i128);

    let total_distributed: i128 = results.iter().map(|r| r.amount).sum();
    assert_eq!(total_distributed + fee, gross_amount);
}

#[test]
fn test_zero_amount_rejected() {
    let env = Env::default();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let mut splits: Vec<SplitEntry> = Vec::new(&env);
    splits.push_back(SplitEntry {
        recipient: alice.clone(),
        bps: 5_000,
    });
    splits.push_back(SplitEntry {
        recipient: bob.clone(),
        bps: 5_000,
    });

    let result = calculate_split(&env, 0, &splits);
    assert_eq!(result, Err(()));
}

#[test]
fn test_negative_amount_rejected() {
    let env = Env::default();
    let alice = Address::generate(&env);

    let mut splits: Vec<SplitEntry> = Vec::new(&env);
    splits.push_back(SplitEntry {
        recipient: alice.clone(),
        bps: 10_000,
    });

    let result = calculate_split(&env, -100, &splits);
    assert_eq!(result, Err(()));
}
