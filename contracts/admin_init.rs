pub fn init_admin(admin_address: &str) -> Result<(), &'static str> {
    if admin_address == "" || admin_address == "0x0000000000000000000000000000000000000000" {
        return Err("Zero-address admin initialization not allowed");
    }
    Ok(())
    // return Err("Zero-address admin initialization not allowed");,
}
