// contracts/workspace_booking/src/lib.rs
#![no_std]
// The env.events().publish() API is deprecated in favour of #[contractevent],
// but kept here for consistency with the rest of the Oraculum contracts.
#![allow(deprecated)]

mod errors;
mod types;

#[cfg(test)]
mod test;

pub use errors::Error;
pub use types::{
    Booking, BookingStatus, MAX_ID_LEN, UnavailabilityReason, Workspace, WorkspaceAvailability,
    WorkspaceType,
};
pub use types::WorkspaceBookingsPage;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Vec,
};

const ADMIN_TRANSFER_TTL: u64 = 86_400;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Contract administrator address.
    Admin,
    /// Address of the USDC / payment token contract.
    PaymentToken,
    /// Workspace record keyed by workspace ID.
    Workspace(String),
    /// Ordered list of all registered workspace IDs.
    WorkspaceList,
    /// Booking record keyed by booking ID.
    Booking(String),
    /// List of booking IDs associated with a member.
    MemberBookings(Address),
       /// List of booking IDs associated with a workspace (full history, never pruned).
    WorkspaceBookings(String),
    /// List of currently-active booking IDs for a workspace, kept in sync on
    /// every status transition so `is_slot_available` never has to scan
    /// completed/cancelled/expired/no-show history.
    ActiveWorkspaceBookings(String),
    /// Pending two-step admin transfer.
    PendingAdminTransfer,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingAdminTransfer {
    pub proposed_admin: Address,
    pub proposer: Address,
    pub expiry: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────
#[contract]
pub struct WorkspaceBookingContract;

#[contractimpl]
impl WorkspaceBookingContract {
    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AdminNotSet)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = Self::get_admin(env)?;
        if caller != &admin {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn get_payment_token(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .ok_or(Error::PaymentTokenNotSet)
    }

    /// Returns `true` if no active booking for `workspace_id` overlaps
    /// the half-open interval [`start_time`, `end_time`).
    ///
    /// C13 — Prevent workspace double booking:
    /// - Overlapping intervals (`existing.start < new.end && existing.end > new.start`)
    ///   are conflicts and make the slot unavailable.
    /// - Adjacent intervals that only touch at a boundary
    ///   (`existing.end == new.start` or `new.end == existing.start`) do **not**
    ///   overlap and are allowed.
    fn is_slot_available(env: &Env, workspace_id: &String, start_time: u64, end_time: u64) -> bool {
        let booking_ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveWorkspaceBookings(workspace_id.clone()))
            .unwrap_or(Vec::new(env));

        for i in 0..booking_ids.len() {
            let bid = booking_ids.get(i).unwrap();
            let booking: Booking = match env.storage().persistent().get(&DataKey::Booking(bid)) {
                Some(b) => b,
                None => continue,
            };

            // Defensive: the active index should only ever contain active
            // bookings, but a stale/inconsistent entry must never cause a
            // false conflict.
            if !booking.status.is_active() {
                continue;
            }

            // Half-open overlap: [a,b) ∩ [c,d) ≠ ∅ ⇔ a < d && b > c.
            // Equality at a boundary (b == c or d == a) is adjacent, not overlapping.
            if booking.start_time < end_time && booking.end_time > start_time {
                return false;
            }
        }
        true
    }

    /// Returns the total seats already booked by active bookings for
    /// `workspace_id` that overlap the half-open interval [`start_time`, `end_time`).
    ///
    /// Uses saturating addition to avoid overflow; the sum is bounded by the
    /// workspace capacity (`u32::MAX` at most), so ordinary wrapping is not
    /// a concern in practice.
    fn booked_seats_in_window(
        env: &Env,
        workspace_id: &String,
        start_time: u64,
        end_time: u64,
    ) -> u32 {
        let booking_ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveWorkspaceBookings(workspace_id.clone()))
            .unwrap_or(Vec::new(env));

        let mut total: u32 = 0;
        for i in 0..booking_ids.len() {
            let bid = booking_ids.get(i).unwrap();
            let booking: Booking = match env.storage().persistent().get(&DataKey::Booking(bid)) {
                Some(b) => b,
                None => continue,
            };
            if !booking.status.is_active() {
                continue;
            }
            // Same half-open overlap predicate as is_slot_available.
            if booking.start_time < end_time && booking.end_time > start_time {
                total = total.saturating_add(booking.seats_requested);
            }
        }
        total
    }

    /// Removes `booking_id` from the active-bookings index for `workspace_id`.
    /// Called by every status transition that leaves the Active state
    /// (Cancelled, Completed, NoShow, Expired). The full-history
    /// `WorkspaceBookings` index is never touched — `get_workspace_bookings`
    /// must keep returning every booking ever made.
    fn remove_active_booking(env: &Env, workspace_id: &String, booking_id: &String) {
        let key = DataKey::ActiveWorkspaceBookings(workspace_id.clone());
        let active: Vec<String> = env.storage().persistent().get(&key).unwrap_or(Vec::new(env));
        let mut updated = Vec::new(env);
        for i in 0..active.len() {
            let id = active.get(i).unwrap();
            if &id != booking_id {
                updated.push_back(id);
            }
        }
        env.storage().persistent().set(&key, &updated);
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    /// One-time setup. Sets the admin and the payment token address.
    pub fn initialize(env: Env, admin: Address, payment_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);

        env.events()
            .publish((symbol_short!("init"),), (admin, payment_token));
        Ok(())
    }

    /// Propose transferring admin control to `new_admin`.
    ///
    /// The proposed admin must accept before the transfer takes effect.
    pub fn propose_admin_transfer(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &current_admin)?;

        if current_admin == new_admin {
            return Err(Error::InvalidAdminTransfer);
        }

        let pending_transfer = PendingAdminTransfer {
            proposed_admin: new_admin.clone(),
            proposer: current_admin.clone(),
            expiry: env.ledger().timestamp() + ADMIN_TRANSFER_TTL,
        };

        env.storage()
            .instance()
            .set(&DataKey::PendingAdminTransfer, &pending_transfer);

        env.events().publish(
            (symbol_short!("adm_prop"), new_admin.clone()),
            current_admin,
        );
        Ok(())
    }

    /// Accept a pending admin transfer as the proposed admin.
    pub fn accept_admin_transfer(env: Env, new_admin: Address) -> Result<(), Error> {
        let pending_transfer: PendingAdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdminTransfer)
            .ok_or(Error::InvalidAdminTransfer)?;

        if pending_transfer.proposed_admin != new_admin {
            return Err(Error::Unauthorized);
        }

        if env.ledger().timestamp() >= pending_transfer.expiry {
            return Err(Error::AdminTransferExpired);
        }

        new_admin.require_auth();

        let old_admin = Self::get_admin(&env)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdminTransfer);

        env.events()
            .publish((symbol_short!("adm_xfer"), new_admin), old_admin);
        Ok(())
    }

    /// Cancel a pending admin transfer before it is accepted.
    pub fn cancel_admin_transfer(env: Env, current_admin: Address) -> Result<(), Error> {
        Self::require_admin(&env, &current_admin)?;

        let pending_transfer: PendingAdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdminTransfer)
            .ok_or(Error::InvalidAdminTransfer)?;

        if pending_transfer.proposer != current_admin {
            return Err(Error::Unauthorized);
        }

        env.storage()
            .instance()
            .remove(&DataKey::PendingAdminTransfer);

        env.events().publish(
            (
                symbol_short!("adm_canc"),
                pending_transfer.proposed_admin.clone(),
            ),
            current_admin,
        );
        Ok(())
    }

    // ── Workspace management (admin-only) ─────────────────────────────────────

    /// Register a new bookable workspace.
    ///
    /// * `id`             – unique identifier for this workspace.
    /// * `name`           – human-readable name.
    /// * `workspace_type` – category (HotDesk / DedicatedDesk / PrivateOffice / MeetingRoom).
    /// * `capacity`       – max simultaneous occupants (≥ 1).
    /// * `hourly_rate`    – price per hour in smallest payment-token units (> 0).
    pub fn register_workspace(
        env: Env,
        caller: Address,
        id: String,
        name: String,
        workspace_type: WorkspaceType,
        capacity: u32,
        hourly_rate: u128,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        if name.len() > types::MAX_NAME_LEN {
            return Err(Error::StringTooLong);
        }
        if capacity == 0 {
            return Err(Error::InvalidCapacity);
        }
        if hourly_rate == 0 {
            return Err(Error::InvalidRate);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Workspace(id.clone()))
        {
            return Err(Error::WorkspaceAlreadyExists);
        }

        let workspace = Workspace {
            id: id.clone(),
            name: name.clone(),
            workspace_type: workspace_type.clone(),
            capacity,
            hourly_rate,
            availability: WorkspaceAvailability::Available,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Workspace(id.clone()), &workspace);

        let mut list: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::WorkspaceList)
            .unwrap_or(Vec::new(&env));
        list.push_back(id.clone());
        env.storage().persistent().set(&DataKey::WorkspaceList, &list);

        env.events().publish(
            (symbol_short!("ws_reg"), id),
            (name, workspace_type, capacity, hourly_rate),
        );
        Ok(())
    }

    /// Toggle a workspace's availability. Unavailable workspaces cannot accept
    /// new bookings but existing active bookings are unaffected.
    pub fn set_workspace_availability(
        env: Env,
        caller: Address,
        workspace_id: String,
        is_available: bool,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut workspace: Workspace = env
            .storage()
            .persistent()
            .get(&DataKey::Workspace(workspace_id.clone()))
            .ok_or(Error::WorkspaceNotFound)?;

        workspace.availability = if is_available {
            WorkspaceAvailability::Available
        } else {
            WorkspaceAvailability::Unavailable(UnavailabilityReason::AdminHold)
        };
        env.storage()
            .persistent()
            .set(&DataKey::Workspace(workspace_id.clone()), &workspace);

        env.events()
            .publish((symbol_short!("ws_avail"), workspace_id), (is_available,));
        Ok(())
    }

    /// Update the hourly rate for a workspace (applies to future bookings only).
    pub fn set_workspace_rate(
        env: Env,
        caller: Address,
        workspace_id: String,
        hourly_rate: u128,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        if hourly_rate == 0 {
            return Err(Error::InvalidRate);
        }

        let mut workspace: Workspace = env
            .storage()
            .persistent()
            .get(&DataKey::Workspace(workspace_id.clone()))
            .ok_or(Error::WorkspaceNotFound)?;

        workspace.hourly_rate = hourly_rate;
        env.storage()
            .persistent()
            .set(&DataKey::Workspace(workspace_id.clone()), &workspace);

        env.events()
            .publish((symbol_short!("ws_rate"), workspace_id), (hourly_rate,));
        Ok(())
    }

    // ── Booking ───────────────────────────────────────────────────────────────

    /// Reserve seats in a workspace for a time slot.
    ///
    /// The caller must have pre-approved the contract to spend `amount` of the
    /// payment token (or the caller's auth tree must cover the sub-invocation).
    /// Cost is rounded **up** to the nearest full hour.
    ///
    /// All capacity and seat-count validations happen **before** payment
    /// transfer so that invalid requests never move funds.
    ///
    /// * `booking_id`      – unique ID chosen by the caller (e.g. a UUID).
    /// * `workspace_id`    – workspace to book.
    /// * `start_time`      – Unix timestamp (seconds) for start of reservation.
    /// * `end_time`        – Unix timestamp (seconds) for end of reservation.
    /// * `seats_requested` – number of seats to reserve (≥ 1,
    ///                       ≤ remaining available capacity in the window).
    pub fn book_workspace(
        env: Env,
        member: Address,
        booking_id: String,
        workspace_id: String,
        start_time: u64,
        end_time: u64,
        seats_requested: u32,
    ) -> Result<(), Error> {
        member.require_auth();

        // ── 1. Argument validation ────────────────────────────────────────────
        if booking_id.len() > MAX_ID_LEN {
            return Err(Error::StringTooLong);
        }
        if workspace_id.len() > MAX_ID_LEN {
            return Err(Error::StringTooLong);
        }

        // seats_requested must be at least 1.
        if seats_requested == 0 {
            return Err(Error::InvalidSeatCount);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Booking(booking_id.clone()))
        {
            return Err(Error::BookingAlreadyExists);
        }

        let now = env.ledger().timestamp();

        if start_time >= end_time || end_time <= now {
            return Err(Error::InvalidTimeRange);
        }

        // ── 2. Load workspace and validate capacity ───────────────────────────
        let workspace: Workspace = env
            .storage()
            .persistent()
            .get(&DataKey::Workspace(workspace_id.clone()))
            .ok_or(Error::WorkspaceNotFound)?;

        // seats_requested must not exceed the workspace's total capacity.
        if seats_requested > workspace.capacity {
            return Err(Error::CapacityExceeded);
        }

        if workspace.availability != WorkspaceAvailability::Available {
            return Err(Error::WorkspaceUnavailable);
        }

        // ── 3. Check time-slot conflict and remaining seat capacity ───────────
        // Count seats already booked by active bookings that overlap the
        // requested window. Uses saturating arithmetic to guard against overflow.
        let already_booked =
            Self::booked_seats_in_window(&env, &workspace_id, start_time, end_time);

        // Remaining capacity = workspace.capacity − already_booked.
        // Because already_booked is derived from stored active bookings and each
        // was validated against workspace.capacity at booking time, the subtraction
        // cannot underflow, but we use saturating_sub defensively.
        let remaining = workspace.capacity.saturating_sub(already_booked);

        if seats_requested > remaining {
            return Err(Error::CapacityExceeded);
        }

        // If the new booking would consume ALL remaining seats we also need
        // to ensure there is no direct time-slot conflict (i.e. the slot is
        // still physically usable).  When the workspace has capacity > 1 the
        // seat check above is the binding constraint; when capacity == 1 a
        // full-seat booking (seats_requested == 1 == capacity) means remaining
        // would be 0 only if already_booked == 1, which is caught above.
        // The is_slot_available check below catches the case where
        // `already_booked == 0` but a single-seat workspace had a prior
        // full booking (no remaining but no double-count).
        if !Self::is_slot_available(&env, &workspace_id, start_time, end_time) {
            return Err(Error::BookingConflict);
        }

        // ── 4. Calculate payment ──────────────────────────────────────────────
        // Cost = hourly_rate × ⌈duration_seconds / 3600⌉
        let duration_secs = end_time - start_time;
        let duration_hours = duration_secs.div_ceil(3600);
        let amount: u128 = workspace.hourly_rate * duration_hours as u128;

        // ── 5. Collect payment (only after all validations pass) ──────────────
        let payment_token = Self::get_payment_token(&env)?;
        token::Client::new(&env, &payment_token).transfer(
            &member,
            env.current_contract_address(),
            &(amount as i128),
        );

        // ── 6. Persist booking and update indexes ─────────────────────────────
        let booking = Booking {
            id: booking_id.clone(),
            workspace_id: workspace_id.clone(),
            member: member.clone(),
            start_time,
            end_time,
            status: BookingStatus::initial(),
            amount_paid: amount,
            seats_requested,
            created_at: now,
            cancelled_at: None,
            completed_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Booking(booking_id.clone()), &booking);

        // Index: workspace → bookings (full history — never pruned)
        let mut ws_bookings: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::WorkspaceBookings(workspace_id.clone()))
            .unwrap_or(Vec::new(&env));
        ws_bookings.push_back(booking_id.clone());
        env.storage().persistent().set(
            &DataKey::WorkspaceBookings(workspace_id.clone()),
            &ws_bookings,
        );

        // Index: workspace → active bookings only (used by is_slot_available)
        let mut active_bookings: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveWorkspaceBookings(workspace_id.clone()))
            .unwrap_or(Vec::new(&env));
        active_bookings.push_back(booking_id.clone());
        env.storage().persistent().set(
            &DataKey::ActiveWorkspaceBookings(workspace_id.clone()),
            &active_bookings,
        );

        // Index: member → bookings
        let mut member_bookings: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::MemberBookings(member.clone()))
            .unwrap_or(Vec::new(&env));
        member_bookings.push_back(booking_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::MemberBookings(member.clone()), &member_bookings);

        env.events().publish(
            (symbol_short!("booked"), booking_id),
            (member, workspace_id, start_time, end_time, amount),
        );
        Ok(())
    }

    /// Cancel an active booking and refund the member.
    ///
    /// The refund amount depends on the cancellation timing:
    /// - **Before the booking starts**: full refund.
    /// - **During the booking**: refund proportional to the unused time.
    /// - **After the booking ends**: no refund.
    ///
    /// Only the booking member or the admin may cancel.
    pub fn cancel_booking(env: Env, caller: Address, booking_id: String) -> Result<(), Error> {
        caller.require_auth();

        let mut booking: Booking = env
            .storage()
            .persistent()
            .get(&DataKey::Booking(booking_id.clone()))
            .ok_or(Error::BookingNotFound)?;

                let admin = Self::get_admin(&env)?;
        if caller != booking.member && caller != admin {
            return Err(Error::Unauthorized);
        }
        if booking.status == BookingStatus::Cancelled {
            return Err(Error::BookingAlreadyCancelled);
        }
        if !booking.status.is_active() {
            return Err(Error::BookingNotActive);
        }

        let now = env.ledger().timestamp();

        let duration = booking.end_time - booking.start_time;

        let refund: u128 = if now >= booking.end_time {
            // Booking period has fully elapsed — no refund.
            0
        } else if now >= booking.start_time {
            // Cancelled mid-booking: refund only the unused portion.
            let remaining = (booking.end_time - now) as u128;
            booking.amount_paid * remaining / duration as u128
        } else {
            // Cancelled before the booking starts — full refund.
            booking.amount_paid
        };

        if refund > 0 {
            let payment_token = Self::get_payment_token(&env)?;
            token::Client::new(&env, &payment_token).transfer(
                &env.current_contract_address(),
                &booking.member,
                &(refund as i128),
            );
        }

           booking.status = booking
            .status
            .transition(BookingStatus::Cancelled)
            .map_err(|_| Error::BookingNotActive)?;
        booking.cancelled_at = Some(now);
        env.storage()
            .persistent()
            .set(&DataKey::Booking(booking_id.clone()), &booking);
        Self::remove_active_booking(&env, &booking.workspace_id, &booking_id);

        env.events().publish(
            (symbol_short!("cancel"), booking_id),
            (caller, refund),
        );
        Ok(())
    }

    /// Mark an active booking as completed (admin only).
    ///
    /// Call this after the member has checked out to close the booking record.
    pub fn complete_booking(env: Env, caller: Address, booking_id: String) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut booking: Booking = env
            .storage()
            .persistent()
            .get(&DataKey::Booking(booking_id.clone()))
            .ok_or(Error::BookingNotFound)?;

        if !booking.status.is_active() {
            return Err(Error::BookingNotActive);
        }

           booking.status = booking
            .status
            .transition(BookingStatus::Completed)
            .map_err(|_| Error::BookingNotActive)?;
        booking.completed_at = Some(env.ledger().timestamp());
        env.storage()
            .persistent()
            .set(&DataKey::Booking(booking_id.clone()), &booking);
        Self::remove_active_booking(&env, &booking.workspace_id, &booking_id);

        env.events().publish(
            (symbol_short!("complete"), booking_id),
            (booking.workspace_id, booking.member),
        );
        Ok(())
    }

    // ── ADDED BY FIX #267: NoShow and Expired status functions ──────────────

    /// Mark an active booking as NoShow (admin only).
    ///
    /// Use this when the member fails to appear for their reservation.
    /// The booking period must have started (start_time <= now).
    pub fn mark_no_show(env: Env, caller: Address, booking_id: String) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut booking: Booking = env
            .storage()
            .persistent()
            .get(&DataKey::Booking(booking_id.clone()))
            .ok_or(Error::BookingNotFound)?;

        if !booking.status.is_active() {
            return Err(Error::BookingNotActive);
        }

        let now = env.ledger().timestamp();
        if now < booking.start_time {
            return Err(Error::BookingConflict); // Too early to mark no-show
        }

          booking.status = booking
            .status
            .transition(BookingStatus::NoShow)
            .map_err(|_| Error::BookingNotActive)?;
        booking.cancelled_at = Some(now);
        env.storage()
            .persistent()
            .set(&DataKey::Booking(booking_id.clone()), &booking);
        Self::remove_active_booking(&env, &booking.workspace_id, &booking_id);

        env.events().publish(
            (symbol_short!("noshow"), booking_id),
            (booking.workspace_id, booking.member),
        );
        Ok(())
    }

    /// Expire an active booking whose end_time has passed (admin only).
    ///
    /// Use this for bookings that were neither completed nor cancelled
    /// before their window closed.
    pub fn expire_booking(env: Env, caller: Address, booking_id: String) -> Result<(), Error> {
        Self::require_admin(&env, &caller)?;

        let mut booking: Booking = env
            .storage()
            .persistent()
            .get(&DataKey::Booking(booking_id.clone()))
            .ok_or(Error::BookingNotFound)?;

        if !booking.status.is_active() {
            return Err(Error::BookingNotActive);
        }

        let now = env.ledger().timestamp();
        if now < booking.end_time {
            return Err(Error::BookingConflict); // Booking hasn't ended yet
        }

        booking.status = booking
            .status
            .transition(BookingStatus::Expired)
            .map_err(|_| Error::BookingNotActive)?;
        booking.cancelled_at = Some(now);
        env.storage()
            .persistent()
            .set(&DataKey::Booking(booking_id.clone()), &booking);
        Self::remove_active_booking(&env, &booking.workspace_id, &booking_id);

        env.events().publish(
            (symbol_short!("expired"), booking_id),
            (booking.workspace_id, booking.member),
        );
        Ok(())
    }
    
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Fetch a workspace record by ID.
    pub fn get_workspace(env: Env, workspace_id: String) -> Result<Workspace, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Workspace(workspace_id))
            .ok_or(Error::WorkspaceNotFound)
    }

    /// Fetch a booking record by ID.
    pub fn get_booking(env: Env, booking_id: String) -> Result<Booking, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Booking(booking_id))
            .ok_or(Error::BookingNotFound)
    }

    /// Return all registered workspace IDs (in registration order).
    pub fn get_all_workspaces(env: Env) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::WorkspaceList)
            .unwrap_or(Vec::new(&env))
    }

    /// Return all booking IDs made by a specific member.
    pub fn get_member_bookings(env: Env, member: Address) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::MemberBookings(member))
            .unwrap_or(Vec::new(&env))
    }

    /// Return all booking IDs associated with a specific workspace.
    pub fn get_workspace_bookings(env: Env, workspace_id: String) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::WorkspaceBookings(workspace_id))
            .unwrap_or(Vec::new(&env))
    }

    /// Return a bounded page of booking IDs associated with a specific workspace.
    ///
    /// Ordering is stable: bookings are returned in insertion (registration)
    /// order, which is the same order as `get_workspace_bookings`.
    ///
    /// * `offset` – zero-based index of the first booking to return.
    /// * `limit`  – maximum number of booking IDs to return.
    ///
    /// The returned `WorkspaceBookingsPage.next_offset` is `Some(n)` when more
    /// entries remain (pass `n` as the next `offset`), or `None` when the page
    /// reaches the end of the history.
    pub fn get_workspace_bookings_page(
        env: Env,
        workspace_id: String,
        offset: u32,
        limit: u32,
    ) -> WorkspaceBookingsPage {
        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::WorkspaceBookings(workspace_id))
            .unwrap_or(Vec::new(&env));

        let total = all.len();
        let mut page = Vec::new(&env);

        if limit == 0 || offset >= total {
            return WorkspaceBookingsPage {
                booking_ids: page,
                next_offset: None,
            };
        }

        let end = core::cmp::min(offset.saturating_add(limit), total);
        let mut i = offset;
        while i < end {
            page.push_back(all.get(i).unwrap());
            i += 1;
        }

        let next_offset = if end < total { Some(end) } else { None };

        WorkspaceBookingsPage {
            booking_ids: page,
            next_offset,
        }
    }

    /// Check whether a workspace has no conflicting active booking in the
    /// requested slot. Returns `false` if the workspace does not exist or is
    /// marked unavailable.
    pub fn check_availability(
        env: Env,
        workspace_id: String,
        start_time: u64,
        end_time: u64,
    ) -> bool {
        let workspace: Workspace = match env
            .storage()
            .persistent()
            .get(&DataKey::Workspace(workspace_id.clone()))
        {
            Some(ws) => ws,
            None => return false,
        };

        if workspace.availability != WorkspaceAvailability::Available {
            return false;
        }

        Self::is_slot_available(&env, &workspace_id, start_time, end_time)
    }

    /// Return the current admin address.
    pub fn admin(env: Env) -> Result<Address, Error> {
        Self::get_admin(&env)
    }

    /// Return the pending admin transfer, if one exists.
    pub fn get_pending_admin_transfer(env: Env) -> Option<PendingAdminTransfer> {
        env.storage().instance().get(&DataKey::PendingAdminTransfer)
    }

    /// Return the payment token address.
    pub fn payment_token(env: Env) -> Result<Address, Error> {
        Self::get_payment_token(&env)
    }
}
