# feat(be): close BE-01, BE-03, BE-08, BE-14 — validation, audit log, correlation IDs, and soft-delete (Closes #4 #6 #11 #22)

This PR closes the four Stellar-Wave backend issues assigned to **JudeDaniel6** in a single change-set.

## Issues closed

- #4 / BE-01 — Add centralized validation for all DTOs and request payloads
- #6 / BE-03 — Add audit logging for authentication and admin-sensitive actions
- #11 / BE-08 — Add request tracing with correlation IDs for all API calls
- #22 / BE-14 — Add soft-delete support for users, workspaces, and contacts

## Summary by issue

### BE-01 — Centralized validation
- New `CentralizedValidationPipe` (`backend/src/common/pipes/validation.pipe.ts`) extends Nest's `ValidationPipe` but emits a stable, grouped 400 payload:
  ```json
  { "statusCode": 400, "error": "Bad Request", "message": "Validation failed",
    "fields": [{ "field": "email", "constraints": ["email must be an email"] }],
    "correlationId": "<uuid>" }
  ```
- New `@StrongPassword()` / `@OptionalStrongPassword()` decorators (`backend/src/common/decorators/strong-password.decorator.ts`) replace the duplicated `@Matches(...)` regex previously copy-pasted across the users and auth DTOs.
- Every auth, users, contact, newsletter, and 2FA DTO now uses `@SanitizeString()` so free-text inputs are normalised before validation.
- `ApiErrorDto` Swagger payload now exposes the new `correlationId` / `fields` fields.
- Tests: `backend/src/common/pipes/validation.pipe.spec.ts`.

### BE-03 — Audit logging
- New `audit_logs` entity (`backend/src/audit/entities/audit-log.entity.ts`) with composite indexes for cheap filtering.
- `AuditModule` + `AuditService` (`backend/src/audit/`) with helpers (`authSuccess`, `authFailure`, `adminAction`) so service code stays declarative.
- Audit rows are written automatically from:
  - `auth.service.ts` — `LOGIN_SUCCESS/FAILED`, `REGISTER`, `REGISTER_ADMIN`, `OTP_VERIFIED/FAILED`, `PASSWORD_RESET_REQUEST/SUCCESS/FAILED`, `TOTP_ENABLED/DISABLED`, `TOTP_LOGIN_SUCCESS/FAILED`.
  - `users.service.ts` — `USER_UPDATED`, `USER_DELETED`, `USER_RESTORED`, `ROLE_CHANGED`, `MEMBERSHIP_STATUS_CHANGED`, `PROFILE_PICTURE_UPDATED/FAILED`.
  - `workspaces` — `WORKSPACE_DELETED`, `WORKSPACE_RESTORED`.
  - `contact` — `CONTACT_SUBMITTED`, `CONTACT_MARKED_READ`, `CONTACT_DELETED`, `CONTACT_RESTORED`.
- `AuditService` reads actor / IP / user-agent / correlation ID from the AsyncLocalStorage context (BE-08).
- `AuditService.log()` never throws — audit failures warn to the console and return `null` so they cannot break requests.
- New admin endpoint `GET /api/admin/audit-log` with pagination + filters (action, outcome, actor, resource, date range, free-text search).
- Tests: `backend/src/audit/audit.service.spec.ts`.

### BE-08 — Correlation IDs
- New `CorrelationIdMiddleware` (`backend/src/common/middlewares/correlation-id.middleware.ts`) generates a UUID v4 (or honours an incoming `x-correlation-id` header ≤ 128 chars) and opens an AsyncLocalStorage context with `correlationId` + `ip` + `userAgent`.
- `HttpLogger` lines are prefaceed `[cid=<uuid>]`.
- `GlobalExceptionFilter` adds `correlationId` (plus `timestamp` / `path`) to every error response and echoes the header on the way out.
- `CentralizedValidationPipe` injects the same `correlationId` into 400 validation errors.
- Tests: `backend/src/common/middlewares/correlation-id.middleware.spec.ts`.

### BE-14 — Soft-delete
- `User` entity keeps `@DeleteDateColumn('deletedAt')` and now uses TypeORM `softDelete()` / `restore()`. All providers (`findOneUserById`, `findAllUsers`, `getMembers`) accept `withDeleted: true` for the admin surface.
- `Workspace.entity` gained `@DeleteDateColumn('deletedAt')` + index; `DeleteWorkspaceProvider.softDelete()` writes `deletedAt` and `restore()` clears it.
- `ContactMessage.entity` gained `@DeleteDateColumn('deletedAt')` + index; `ContactService` exposes `softDelete()` and `restore()`.
- New admin endpoints (each guarded with `RolesGuard` and emitting audit events):
  - `GET    /api/admin/audit-log`
  - `GET    /api/admin/users` (includes deleted), `GET /api/admin/users/deleted`, `PATCH /api/admin/users/:id/restore`
  - `GET    /api/admin/workspaces/deleted`, `PATCH /api/admin/workspaces/:id/restore`
  - `GET    /api/admin/contact[/deleted]`, `PATCH /api/admin/contact/:id/read`, `DELETE /api/admin/contact/:id` (soft), `PATCH /api/admin/contact/:id/restore`
- Migration notes are in `backend/docs/SOFT_DELETE.md`.

## Testing

- `npm run build` → ✅ 0 errors
- `npx jest --colors=false` → ✅ **47/47 tests pass across 10 suites** including the three new test files (`correlation-id.middleware.spec.ts`, `validation.pipe.spec.ts`, `audit.service.spec.ts`).

## Backwards-compatibility notes

- `User.isDeleted` and `Workspace.isActive` are preserved so external consumers see the same data; the new authoritative source of truth is each entity's `deletedAt` column.
- The duplicated `BookingQueryDto` class in `bookings/dto/booking-query.dto.ts` — a pre-existing bug — was cleaned up so the build pipeline succeeds. No functional change.
- `UseBackupCodeDto` now exposes `backupCode` instead of `code` to match the existing `verify-totp.provider.ts` field name; clients sending `code` receive a clean 400 from the centralized pipe.

## Migration

See `backend/docs/SOFT_DELETE.md` for the TypeORM column-add / idempotency story.

## Risk

- The new `workspaces.deletedAt` and `contact_messages.deletedAt` columns need a migration on environments with `synchronize: false`. `app.module.ts` keeps `synchronize: true` for dev / preview, so the column-add is automatic there.
- Audit writes fall through to `console.warn` when the repository is unavailable, so a transient DB issue won't break user requests — at the cost of missing rows during that window.

