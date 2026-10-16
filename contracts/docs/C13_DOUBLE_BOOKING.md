# C13 — Prevent workspace double booking

## Goal

Ensure a workspace cannot be reserved for overlapping time ranges. Payment must
only move when the booking is accepted.

## Contract behavior (`workspace_booking`)

Slot availability uses a **half-open** interval `[start_time, end_time)`:

| Case | Condition | Result |
| --- | --- | --- |
| Overlap | `existing.start < new.end && existing.end > new.start` | `Error::BookingConflict` (102) |
| Adjacent (touching) | `existing.end == new.start` or `new.end == existing.start` | Allowed |
| Inactive bookings | status ≠ `Active` (cancelled / completed / expired / no-show) | Ignored for conflicts |

`book_workspace` runs the conflict check **before** the payment-token transfer.
A rejected booking therefore leaves member and contract balances unchanged.

Public helpers:

- `check_availability(workspace_id, start, end)` — read-only overlap query
- `is_slot_available` (internal) — shared by booking + availability checks

## Acceptance criteria

1. Overlapping intervals fail with `BookingConflict`.
2. Adjacent intervals (boundary-touch only) succeed.
3. Failed bookings do not transfer funds.

Covered by tests in `contracts/workspace_booking/src/test.rs` (`test_c13_*`).
