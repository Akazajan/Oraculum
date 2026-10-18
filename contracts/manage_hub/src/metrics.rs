//! Analytics metric helpers.
//!
//! These are pure, deterministic helpers so they can be unit-tested without a
//! contract execution frame. They are intentionally free of storage access so
//! callers stay in control of *which* data samples define a reporting period.

/// Computes a churn rate expressed as a whole-number percentage.
///
/// # Definition
///
/// The churn rate is the share of the starting subscriber base that was lost
/// over a reporting period:
///
/// ```text
/// churn_rate = (subscribers_at_start - subscribers_at_end) * 100
///              / subscribers_at_start
/// ```
///
/// Both bounds of the *period* are explicit arguments rather than implicit
/// state, so the denominator used for a given figure is always documented and
/// reproducible: `subscribers_at_start` is the size of the base at the start of
/// the period and `subscribers_at_end` is its size at the end.
///
/// # Edge cases
///
/// * An **empty** starting base (`subscribers_at_start == 0`) yields `0` — a
///   tier with no subscribers has nobody to churn and there is no division by
///   zero.
/// * A **steady or growing** base (`subscribers_at_end >= subscribers_at_start`)
///   yields `0` — churn counts net losses only.
///
/// The arithmetic saturates and never panics.
pub fn calculate_churn_rate(subscribers_at_start: u32, subscribers_at_end: u32) -> u32 {
    if subscribers_at_start == 0 || subscribers_at_end >= subscribers_at_start {
        return 0;
    }
    let lost = subscribers_at_start - subscribers_at_end;
    lost.saturating_mul(100) / subscribers_at_start
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Empty subscriber set: no subscribers at either boundary → no churn and
    /// no division by zero.
    #[test]
    fn empty_subscriber_set_reports_zero_churn() {
        assert_eq!(calculate_churn_rate(0, 0), 0);
    }

    /// Steady subscriber set: the base is unchanged over the period → no churn.
    #[test]
    fn steady_subscriber_set_reports_zero_churn() {
        assert_eq!(calculate_churn_rate(100, 100), 0);
        assert_eq!(calculate_churn_rate(1, 1), 0);
    }

    /// Growing subscriber set: net additions are not churn.
    #[test]
    fn growing_subscriber_set_reports_zero_churn() {
        assert_eq!(calculate_churn_rate(100, 150), 0);
    }

    /// Declining subscriber set: churn is the percentage of the starting base
    /// that was lost.
    #[test]
    fn declining_subscriber_set_reports_expected_churn() {
        assert_eq!(calculate_churn_rate(100, 75), 25);
        assert_eq!(calculate_churn_rate(200, 150), 25);
        // Total churn.
        assert_eq!(calculate_churn_rate(100, 0), 100);
    }

    /// Integer division truncates towards zero.
    #[test]
    fn churn_rate_truncates_towards_zero() {
        // 1 lost out of 3 ≈ 33.3% → 33.
        assert_eq!(calculate_churn_rate(3, 2), 33);
    }
}
