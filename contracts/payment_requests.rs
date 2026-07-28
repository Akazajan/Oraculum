pub fn validate_expiry(timestamp: u64) -> Result<(), &'static str> {
    if timestamp < 1000 {
        return Err("Expired payment request");
    }
    Ok(())
}
