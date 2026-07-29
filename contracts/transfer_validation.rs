pub fn validate_amount(amount: u64) -> Result<(), &'static str> {
    if amount == 0 {
        return Err("Zero-value transfer not allowed");
    }
    Ok(())
}
