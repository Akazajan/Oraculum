# C16 — Booking state validation

## Goal

Encode valid booking lifecycle states and transition checks in the shared
`BookingStatus` type so invalid states cannot be constructed and illegal
transitions are rejected.

## Helpers (`contracts/workspace_booking/src/types.rs`)

| Helper | Role |
| --- | --- |
| `BookingStatus::try_from_u32` | Construct only valid discriminants (`0..=4`); others → `None` |
| `BookingStatus::as_u32` | Stable serialization mapping (Active=0 … Expired=4) |
| `BookingStatus::initial` | New bookings always start as `Active` |
| `BookingStatus::can_transition` / `transition` | Explicit allowed edges only |
| `is_active` / `is_terminal` | Query helpers |

### Allowed transitions

```
Active → Completed
Active → Cancelled
Active → NoShow
Active → Expired
```

All other edges (including self-transitions and any exit from a terminal
state) are denied. Contract mutators (`cancel_booking`, `complete_booking`,
`mark_no_show`, `expire_booking`) apply `transition` so invalid paths surface
as `Error::BookingNotActive`.

## Acceptance criteria

1. Invalid discriminant values cannot be constructed through the helper.
2. Allowed transitions are explicit in `can_transition`.
3. Serialization discriminants remain stable (`as_u32` round-trip).

Covered by `test_c16_*` in `contracts/workspace_booking/src/test.rs`.
