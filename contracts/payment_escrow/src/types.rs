// contracts/payment_escrow/src/types.rs
use crate::errors::Error;
use soroban_sdk::{contracttype, Address, String};

/// Lifecycle state of an escrow.
///
/// `Pending` and `Disputed` are *live* states — funds are still held by the
/// contract and a settlement decision is outstanding. `Released` and
/// `Refunded` are *terminal*: the funds have left the contract and the escrow
/// must never be settled again.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    /// Funds are locked and awaiting a release decision.
    Pending,
    /// Funds have been sent to the beneficiary.
    Released,
    /// Funds have been returned to the depositor.
    Refunded,
    /// Depositor raised a dispute — admin must resolve before funds move.
    Disputed,
}

impl EscrowStatus {
    /// `true` once the funds have left the contract.
    ///
    /// Terminal escrows are final: a second release, refund or dispute
    /// resolution would double-spend the deposit.
    pub fn is_terminal(&self) -> bool {
        matches!(self, EscrowStatus::Released | EscrowStatus::Refunded)
    }

    /// `true` while the contract still holds the funds.
    pub fn is_live(&self) -> bool {
        !self.is_terminal()
    }

    /// `true` only for the `Pending` state.
    ///
    /// A terminal state is never pending, so callers that gate on "is this
    /// escrow still awaiting a decision?" cannot accidentally admit a settled
    /// escrow.
    pub fn is_pending(&self) -> bool {
        matches!(self, EscrowStatus::Pending)
    }

    /// `true` only for the `Disputed` state.
    pub fn is_disputed(&self) -> bool {
        matches!(self, EscrowStatus::Disputed)
    }

    /// Ensure this escrow is still `Pending`.
    ///
    /// Returns [`Error::EscrowAlreadySettled`] for a terminal state so that
    /// "already settled" stays distinguishable from "not pending because it is
    /// under dispute" ([`Error::EscrowNotPending`]).
    pub fn require_pending(&self) -> Result<(), Error> {
        if self.is_terminal() {
            return Err(Error::EscrowAlreadySettled);
        }
        if !self.is_pending() {
            return Err(Error::EscrowNotPending);
        }
        Ok(())
    }

    /// Ensure this escrow is `Disputed` and still settleable.
    pub fn require_disputed(&self) -> Result<(), Error> {
        if self.is_terminal() {
            return Err(Error::EscrowAlreadySettled);
        }
        if !self.is_disputed() {
            return Err(Error::EscrowNotDisputed);
        }
        Ok(())
    }
}

/// Validate a settlement deadline against the escrow's creation time.
///
/// `deadline` uses the same convention as [`Escrow::release_after`]: zero
/// disables the deadline. A non-zero deadline must fall strictly after
/// `created_at` — a deadline at or before creation would be already elapsed
/// the moment the escrow exists.
pub fn validate_deadline(created_at: u64, deadline: u64) -> Result<(), Error> {
    if deadline == 0 {
        return Ok(());
    }
    if deadline <= created_at {
        return Err(Error::InvalidDeadline);
    }
    Ok(())
}

/// Validate a dispute window against the escrow's creation time.
///
/// A window is a duration, so it only has to stay within `u64` when added to
/// `created_at`; zero disables disputes.
pub fn validate_dispute_window(created_at: u64, window_secs: u64) -> Result<(), Error> {
    if window_secs == 0 {
        return Ok(());
    }
    created_at
        .checked_add(window_secs)
        .ok_or(Error::InvalidDeadline)?;
    Ok(())
}

/// A locked-fund record held in escrow between a depositor and a beneficiary.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Escrow {
    /// Unique escrow identifier provided by the caller.
    pub id: String,
    /// Address that locked the funds (e.g. a hub member paying a deposit).
    pub depositor: Address,
    /// Address that receives the funds upon release (e.g. the hub operator).
    pub beneficiary: Address,
    /// Locked amount in the smallest unit of `payment_token`.
    pub amount: i128,
    /// Token address snapshotted at creation time so future admin changes
    /// do not affect in-flight escrows.
    pub payment_token: Address,
    /// Current lifecycle status.
    pub status: EscrowStatus,
    /// Human-readable purpose (e.g. "Security deposit – booking ws-001").
    pub description: String,
    /// Ledger timestamp when the escrow was created.
    pub created_at: u64,
    /// If non-zero, the beneficiary may self-claim after this Unix timestamp
    /// without waiting for admin approval.  Zero disables auto-claim.
    pub release_after: u64,
    /// Seconds after `created_at` during which the depositor may raise a
    /// dispute.  Zero means disputes are disabled for this escrow.
    pub dispute_window: u64,
    /// Ledger timestamp when a dispute was raised, if any.
    pub dispute_raised_at: Option<u64>,
    /// Ledger timestamp when the escrow was resolved (released/refunded).
    pub resolved_at: Option<u64>,
    /// Fee recipient address (e.g. the hub operator).
    pub fee_recipient: Address,
    /// Fee basis points (e.g. 100 = 1%).
    pub fee_bps: u32,
    /// Calculated fee amount.
    pub fee_amount: i128,
}

impl Escrow {
    /// Validate every deadline carried by this escrow.
    ///
    /// Rejects a `release_after` at or before `created_at`, and a
    /// `dispute_window` that would overflow past the end of time.
    pub fn validate_deadlines(&self) -> Result<(), Error> {
        validate_deadline(self.created_at, self.release_after)?;
        validate_dispute_window(self.created_at, self.dispute_window)
    }

    /// Timestamp after which the depositor may no longer raise a dispute, or
    /// `None` when disputes are disabled for this escrow.
    pub fn dispute_deadline(&self) -> Option<u64> {
        if self.dispute_window == 0 {
            return None;
        }
        self.created_at.checked_add(self.dispute_window)
    }

    /// `true` once the funds have left the contract.
    pub fn is_settled(&self) -> bool {
        self.status.is_terminal()
    }

    /// Ensure this escrow can still be released or refunded from `Pending`.
    pub fn require_pending(&self) -> Result<(), Error> {
        self.status.require_pending()
    }

    /// Ensure this escrow can still have a dispute resolved.
    pub fn require_disputed(&self) -> Result<(), Error> {
        self.status.require_disputed()
    }
}
