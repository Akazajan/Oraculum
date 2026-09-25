#[cfg(test)]
mod fuzz_arithmetic_tests {
    /// Mirror of manage_hub rewards formula constants / shape so overflow
    /// scenarios stay covered without pulling the full contract into this crate.
    const YEAR_SECS: i128 = 31_536_000;
    const BPS_DENOM: i128 = 10_000;

    /// gross = amount * base_rate_bps * elapsed * multiplier_bps
    ///         / (10_000 * YEAR_SECS * 10_000)
    fn calculate_pending_rewards_checked(
        amount: i128,
        base_rate_bps: i128,
        elapsed: i128,
        multiplier_bps: i128,
        claimed_rewards: i128,
    ) -> Result<i128, ()> {
        let gross = amount
            .checked_mul(base_rate_bps)
            .ok_or(())?
            .checked_mul(elapsed)
            .ok_or(())?
            .checked_mul(multiplier_bps)
            .ok_or(())?
            .checked_div(BPS_DENOM.checked_mul(YEAR_SECS).ok_or(())?)
            .ok_or(())?
            .checked_div(BPS_DENOM)
            .ok_or(())?;

        Ok(gross.checked_sub(claimed_rewards).unwrap_or(0).max(0))
    }

    #[test]
    fn test_safe_add_overflow() {
        let a: u128 = u128::MAX / 2;
        let b: u128 = u128::MAX / 2;
        assert!(
            a.checked_add(b).is_some(),
            "Safe addition should not overflow"
        );
    }

    #[test]
    fn test_safe_mul_pricing() {
        let qty: u64 = 1_000_000;
        let price: u64 = 1_000_000;
        let result = qty.checked_mul(price);
        assert!(result.is_some());
    }

    #[test]
    fn test_fee_calculation_precision() {
        let amount: u128 = 1_000_000_000;
        let fee_percent = 5u128;
        let fee = amount
            .checked_mul(fee_percent)
            .and_then(|f| f.checked_div(100));
        assert!(fee.is_some(), "Fee calc should handle safely");
    }

    #[test]
    fn test_share_calculation_precision() {
        let total: u128 = 1_000_000_000;
        let shares = 100u128;
        let per_share = total.checked_div(shares);
        assert!(per_share.is_some(), "Share division should be safe");
        assert_eq!(per_share.unwrap(), 10_000_000);
    }

        #[path = "../payment_requests.rs"]
        mod payment_requests;

        use payment_requests::validate_expiry;

        #[test]
        fn test_payment_request_rejects_expired_timestamp() {
            assert_eq!(
                validate_expiry(1_700_000_000, 1_700_000_001),
                Err("Expired payment request")
            );
        }

        #[test]
        fn test_payment_request_accepts_future_timestamp() {
            assert_eq!(validate_expiry(1_700_000_002, 1_700_000_001), Ok(()));
        }

    // -----------------------------------------------------------------------
    // #283 — Staking reward overflow scenarios (rewards.rs)
    // -----------------------------------------------------------------------

    #[test]
    fn test_reward_calc_normal_path() {
        // 1_000 principal, 500 bps (5%), 1 year, 1x multiplier
        let pending = calculate_pending_rewards_checked(1_000, 500, YEAR_SECS, 10_000, 0)
            .expect("normal reward path must not overflow");
        // gross = 1000 * 500 * YEAR * 10000 / (10000 * YEAR * 10000) = 50
        assert_eq!(pending, 50);
    }

    #[test]
    fn test_reward_calc_amount_times_rate_overflow() {
        // amount * base_rate_bps overflows i128
        let amount = i128::MAX / 2;
        let rate = 10_000i128;
        let result = calculate_pending_rewards_checked(amount, rate, 1, 10_000, 0);
        assert!(result.is_err(), "amount * rate_bps must fail on overflow");
    }

    #[test]
    fn test_reward_calc_elapsed_overflow() {
        // After rate multiply, * elapsed overflows
        let amount = i128::MAX / 20_000;
        let rate = 10_000i128;
        let elapsed = i128::MAX; // forces second multiply overflow
        let result = calculate_pending_rewards_checked(amount, rate, elapsed, 10_000, 0);
        assert!(
            result.is_err(),
            "principal*rate*elapsed must fail on overflow"
        );
    }

    #[test]
    fn test_reward_calc_multiplier_overflow() {
        let amount = i128::MAX / 20_000;
        let rate = 5_000i128;
        let elapsed = 10_000i128;
        let multiplier = i128::MAX; // forces multiplier stage overflow
        let result = calculate_pending_rewards_checked(amount, rate, elapsed, multiplier, 0);
        assert!(
            result.is_err(),
            "including reward_multiplier_bps must fail on overflow"
        );
    }

    #[test]
    fn test_reward_calc_large_but_safe_values() {
        // Large but carefully bounded inputs that still fit i128 through the pipeline.
        let amount = 1_000_000_000_000i128; // 1e12
        let rate = 1_000i128; // 10%
        let elapsed = YEAR_SECS;
        let multiplier = 10_000i128;
        let pending =
            calculate_pending_rewards_checked(amount, rate, elapsed, multiplier, 0).expect("safe");
        // gross = amount * 1000 / 10000 = amount / 10
        assert_eq!(pending, amount / 10);
    }

    #[test]
    fn test_reward_calc_zero_elapsed_is_zero() {
        let pending =
            calculate_pending_rewards_checked(1_000_000, 500, 0, 10_000, 0).expect("zero elapsed");
        assert_eq!(pending, 0);
    }

    #[test]
    fn test_reward_calc_claimed_subtracted() {
        let pending =
            calculate_pending_rewards_checked(1_000, 500, YEAR_SECS, 10_000, 20).expect("claimed");
        assert_eq!(pending, 30);
    }
}

    // ── FIX #268: Payment escrow arithmetic fuzz tests ──────────────────────

    /// Fee + beneficiary amount must always equal the escrow amount.
    /// This is the core invariant for fee calculation.
    fn fee_and_beneficiary_invariant(
        amount: i128,
        fee_bps: i128,
    ) -> Result<(i128, i128), ()> {
        if amount <= 0 || fee_bps < 0 || fee_bps > 10_000 {
            return Err(());
        }

        let fee_amount = amount
            .checked_mul(fee_bps)
            .ok_or(())?
            .checked_div(BPS_DENOM)
            .ok_or(())?;

        let beneficiary_amount = amount
            .checked_sub(fee_amount)
            .ok_or(())?;

        // Invariant: fee + beneficiary == amount
        assert_eq!(
            fee_amount.checked_add(beneficiary_amount).ok_or(())?,
            amount,
            "Invariant violated: fee + beneficiary != amount"
        );

        Ok((fee_amount, beneficiary_amount))
    }

    #[test]
    fn test_escrow_fee_invariant_small_amounts() {
        // Various small amounts and fee percentages
        let test_cases: &[(i128, i128)] = &[
            (1_000, 100),     // 1% fee
            (10_000, 250),    // 2.5% fee
            (100_000, 500),   // 5% fee
            (1_000_000, 1000), // 10% fee
            (1, 100),         // minimum amount, 1% fee
            (10_000, 0),      // zero fee
            (10_000, 10_000), // 100% fee (edge case)
        ];

        for &(amount, fee_bps) in test_cases {
            let result = fee_and_beneficiary_invariant(amount, fee_bps);
            assert!(result.is_ok(), "Failed for amount={}, fee_bps={}", amount, fee_bps);
        }
    }

    #[test]
    fn test_escrow_fee_invariant_large_amounts() {
        // Large amounts that could overflow
        let test_cases: &[(i128, i128)] = &[
            (i128::MAX / 2, 100),
            (1_000_000_000_000, 500),
            (999_999_999_999_999, 1000),
        ];

        for &(amount, fee_bps) in test_cases {
            let result = fee_and_beneficiary_invariant(amount, fee_bps);
            // These may fail due to overflow — that's acceptable
            if let Ok((fee, beneficiary)) = result {
                assert_eq!(fee + beneficiary, amount);
            }
        }
    }

    #[test]
    fn test_escrow_fee_zero_bps() {
        let (fee, beneficiary) = fee_and_beneficiary_invariant(10_000, 0).unwrap();
        assert_eq!(fee, 0);
        assert_eq!(beneficiary, 10_000);
    }

    #[test]
    fn test_escrow_fee_full_bps() {
        let (fee, beneficiary) = fee_and_beneficiary_invariant(10_000, 10_000).unwrap();
        assert_eq!(fee, 10_000);
        assert_eq!(beneficiary, 0);
    }
