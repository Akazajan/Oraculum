use soroban_sdk::{contracttype, Address, String};

/// Maximum allowed length for workspace identifiers.
#[allow(dead_code)]
pub const MAX_ID_LEN: u32 = 64;

/// Maximum allowed length for workspace names.
#[allow(dead_code)]
pub const MAX_NAME_LEN: u32 = 128;

/// Category of workspace being registered.
///
/// NOTE:
/// New variants may be added in future versions.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum WorkspaceType {
    /// Open hot-desk — shared, no dedicated assignment.
    HotDesk,

    /// Reserved desk for a specific member or team.
    DedicatedDesk,

    /// Enclosed private office.
    PrivateOffice,

    /// Meeting / conference room.
    MeetingRoom,

    /// Fully remote / online meeting space.
    Virtual,

    /// Combined physical desk and integrated video-conferencing setup.
    Hybrid,
}

/// Reason a workspace is unavailable.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum UnavailabilityReason {
    /// Temporary maintenance work
    Maintenance,

    /// Workspace permanently removed
    Decommissioned,

    /// Held by administrator
    AdminHold,
}

/// Availability state of a workspace.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum WorkspaceAvailability {
    /// Workspace can be booked
    Available,

    /// Workspace cannot be booked with reason
    Unavailable(UnavailabilityReason),
}

/// Lifecycle state of a booking.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum BookingStatus {
    /// Booking is confirmed and currently active.
    Active,

    /// Booking finished successfully.
    Completed,

    /// Booking cancelled by member or admin.
    Cancelled,

    /// Member never showed up for the reservation.
    NoShow,

    /// Reservation window passed without completion.
    Expired,
}


impl BookingStatus {
    /// Stable u32 discriminant used for on-wire / storage serialization.
    ///
    /// Discriminants are fixed and must never be reordered:
    /// Active=0, Completed=1, Cancelled=2, NoShow=3, Expired=4.
    pub fn as_u32(&self) -> u32 {
        match self {
            BookingStatus::Active => 0,
            BookingStatus::Completed => 1,
            BookingStatus::Cancelled => 2,
            BookingStatus::NoShow => 3,
            BookingStatus::Expired => 4,
        }
    }

    /// Construct a status from its stable discriminant.
    ///
    /// Invalid values cannot be constructed — returns `None` for any
    /// discriminant outside the explicit lifecycle set.
    pub fn try_from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(BookingStatus::Active),
            1 => Some(BookingStatus::Completed),
            2 => Some(BookingStatus::Cancelled),
            3 => Some(BookingStatus::NoShow),
            4 => Some(BookingStatus::Expired),
            _ => None,
        }
    }

    /// Initial lifecycle state for a newly created booking.
    pub fn initial() -> Self {
        BookingStatus::Active
    }

    /// Returns `true` when the booking is currently active.
    pub fn is_active(&self) -> bool {
        matches!(self, BookingStatus::Active)
    }

    /// Returns `true` for terminal states that admit no further transitions.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            BookingStatus::Completed
                | BookingStatus::Cancelled
                | BookingStatus::NoShow
                | BookingStatus::Expired
        )
    }

    /// Explicit allowed lifecycle transitions.
    ///
    /// Only `Active` may transition, and only into a terminal state:
    /// - Active → Completed
    /// - Active → Cancelled
    /// - Active → NoShow
    /// - Active → Expired
    ///
    /// Self-transitions and any transition out of a terminal state are denied.
    pub fn can_transition(&self, to: &BookingStatus) -> bool {
        matches!(
            (self, to),
            (BookingStatus::Active, BookingStatus::Completed)
                | (BookingStatus::Active, BookingStatus::Cancelled)
                | (BookingStatus::Active, BookingStatus::NoShow)
                | (BookingStatus::Active, BookingStatus::Expired)
        )
    }

    /// Apply an allowed transition, or return `Err(())` if the edge is invalid.
    pub fn transition(&self, to: BookingStatus) -> Result<BookingStatus, ()> {
        if self.can_transition(&to) {
            Ok(to)
        } else {
            Err(())
        }
    }
}

/// A physical or logical workspace that can be booked.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Workspace {
    /// Unique workspace identifier (max 64 chars)
    pub id: String,

    /// Human-readable name (max 128 chars)
    pub name: String,

    /// Category of workspace
    pub workspace_type: WorkspaceType,

    /// Maximum simultaneous occupants
    pub capacity: u32,

    /// Hourly rate in smallest unit of payment token
    pub hourly_rate: u128,

    /// Current availability state
    pub availability: WorkspaceAvailability,

    /// Ledger timestamp when workspace was created
    pub created_at: u64,
}

/// A confirmed reservation for a workspace.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Booking {
    /// Caller-provided booking identifier (max 64 chars)
    pub id: String,

    /// ID of workspace being booked
    pub workspace_id: String,

    /// Member who created the booking
    pub member: Address,

    /// Reservation start time (unix seconds)
    pub start_time: u64,

    /// Reservation end time (unix seconds)
    pub end_time: u64,

    /// Current booking lifecycle status
    pub status: BookingStatus,

    /// Amount paid for booking
    pub amount_paid: u128,

    /// Timestamp when booking was created
    pub created_at: u64,

    /// Timestamp booking was cancelled
    pub cancelled_at: Option<u64>,

    /// Timestamp booking was completed
    pub completed_at: Option<u64>,
}
