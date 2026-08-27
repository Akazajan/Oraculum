// contracts/payment_escrow/src/errors.rs
use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    AdminNotSet = 0,
    PaymentTokenNotSet = 1,
    Unauthorized = 2,
    AlreadyInitialized = 3,
    EscrowNotFound = 4,
    EscrowAlreadyExists = 5,
    EscrowNotPending = 6,
    FeeRecipientNotSet = 7,
    DisputeWindowClosed = 8,
    NotDepositor = 9,
    EscrowNotDisputed = 10,
    InvalidAmount = 11,
    DepositorIsBeneficiary = 12,
}
