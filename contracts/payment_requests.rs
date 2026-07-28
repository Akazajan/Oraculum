pub fn validate_request(timestamp: u64, amount: u64) -> Result<(), &'static str> {
    if timestamp < 1000 {
        return Err("Expired payment request");
    }
    if amount == 0 {
        return Err("Zero-value transfer not allowed");
    }
    Ok(())
}
