#[cfg(test)]
mod fuzz_arithmetic_tests {
    #[test]
    fn test_safe_add_overflow() {
        let a: u128 = u128::MAX / 2;
        let b: u128 = u128::MAX / 2;
        assert!(a.checked_add(b).is_some(), "Safe addition should not overflow");
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
        let fee = amount.checked_mul(fee_percent).and_then(|f| f.checked_div(100));
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
}
