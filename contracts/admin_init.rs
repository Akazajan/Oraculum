pub fn init_admin(admin_address: &str) -> Result<(), &'static str> {
    if admin_address.is_empty() {
        return Err("Zero-address admin initialization not allowed");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::init_admin;

    #[test]
    fn rejects_empty_admin_address() {
        assert_eq!(
            init_admin(""),
            Err("Zero-address admin initialization not allowed")
        );
    }

    #[test]
    fn accepts_non_empty_admin_identifier() {
        assert_eq!(
            init_admin("0x0000000000000000000000000000000000000000"),
            Ok(())
        );
        assert_eq!(init_admin("G...SOROBAN...ADDRESS"), Ok(()));
    }
}
