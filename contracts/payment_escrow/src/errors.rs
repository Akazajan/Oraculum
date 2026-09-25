// contracts/payment_escrow/src/errors.rs
use soroban_sdk::contracterror;

/// Contract error definitions.
///
/// Error codes are stable and must never be reordered or reused: existing
/// identifiers are part of the contract's public ABI.
///
/// 0–99   → Core / escrow state errors
/// 100–199 → Token transfer failures
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
    /// A settlement deadline is not strictly after the escrow creation time.
    InvalidDeadline = 13,
    /// The escrow has already reached a terminal state and cannot be treated
    /// as pending or resolved again.
    EscrowAlreadySettled = 14,

    // -----------------------------
    // Token Transfer Failures (100–199)
    // -----------------------------
    /// Pulling the deposit from the depositor into the contract failed.
    ///
    /// Distinct from [`Error::InvalidAmount`]: the amount was valid, but the
    /// token contract rejected the movement (e.g. insufficient balance or a
    /// missing trustline).
    DepositTransferFailed = 100,

    /// Paying the beneficiary their share of a released escrow failed.
    BeneficiaryTransferFailed = 101,

    /// Returning funds to the depositor during a refund failed.
    RefundTransferFailed = 102,

    /// Paying the configured fee recipient failed.
    FeeTransferFailed = 103,
}

/// Which leg of a settlement a token transfer belongs to.
///
/// Callers classify a failing `token::Client::transfer` by its leg so that
/// every failure maps to the same [`Error`] variant regardless of which
/// entry point (`release`, `refund`, `resolve_dispute`, …) performed it.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TransferLeg {
    /// Depositor → contract, when the escrow is created.
    Deposit,
    /// Contract → beneficiary, on release.
    Beneficiary,
    /// Contract → depositor, on refund.
    Refund,
    /// Contract → fee recipient, on any fee-bearing settlement.
    Fee,
}

impl Error {
    /// Map a failed token transfer to its stable transfer-failure error.
    ///
    /// Keeping the mapping in one place guarantees that the same leg always
    /// produces the same code, and that transfer failures stay separable from
    /// escrow-state errors such as [`Error::EscrowNotPending`].
    pub fn from_transfer_leg(leg: TransferLeg) -> Error {
        match leg {
            TransferLeg::Deposit => Error::DepositTransferFailed,
            TransferLeg::Beneficiary => Error::BeneficiaryTransferFailed,
            TransferLeg::Refund => Error::RefundTransferFailed,
            TransferLeg::Fee => Error::FeeTransferFailed,
        }
    }

    /// `true` when this error reports a token transfer that did not settle.
    ///
    /// State errors and transfer errors must remain distinguishable so callers
    /// can retry a transfer failure without retrying an invalid state change.
    pub fn is_transfer_failure(&self) -> bool {
        matches!(
            self,
            Error::DepositTransferFailed
                | Error::BeneficiaryTransferFailed
                | Error::RefundTransferFailed
                | Error::FeeTransferFailed
        )
    }

    /// `true` when this error reports an escrow that is in the wrong state for
    /// the attempted operation.
    pub fn is_state_error(&self) -> bool {
        matches!(
            self,
            Error::EscrowNotFound
                | Error::EscrowAlreadyExists
                | Error::EscrowNotPending
                | Error::EscrowNotDisputed
                | Error::EscrowAlreadySettled
                | Error::DisputeWindowClosed
        )
    }
}
