pub fn validate_expiry(expires_at: u64, current_timestamp: u64) -> Result<(), &'static str> {
    if expires_at <= current_timestamp {
        return Err("Expired payment request");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_expiry;

    #[test]
    fn rejects_expired_realistic_unix_timestamp() {
        assert_eq!(
            validate_expiry(1_700_000_000, 1_700_000_001),
            Err("Expired payment request")
        );
    }

    #[test]
    fn accepts_request_expiring_in_the_future() {
        assert_eq!(validate_expiry(1_700_000_002, 1_700_000_001), Ok(()));
    }
}
