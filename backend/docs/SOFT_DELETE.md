# Soft-Delete (BE-14)

This document describes the soft-delete behaviour implemented for
`User`, `Workspace`, and `ContactMessage` records and how to migrate
or restore them.

## Why soft-delete

Soft-delete preserves historical and audit data while hiding records
from default queries. The four entities that matter for compliance
and operations (`audit_logs`, `payments`, `bookings`, `refresh_tokens`)
keep referential integrity by referencing users and workspaces even
when those records are logically deleted.

## How it works

| Entity        | Column           | Strategy                                                  |
|---------------|------------------|-----------------------------------------------------------|
| `User`        | `deletedAt`      | TypeORM `@DeleteDateColumn()` – automatically excluded by default |
| `Workspace`   | `deletedAt`      | TypeORM `@DeleteDateColumn()` – automatically excluded by default |
| `ContactMessage` | `deletedAt`  | TypeORM `@DeleteDateColumn()` – automatically excluded by default |

TypeORM automatically excludes rows with a non-null `deletedAt` from
the default `find` / query-builder results, so application code no
longer has to remember to filter `isDeleted = false` in every query.

### Existing `isDeleted` and `isActive` flags

Both columns still exist in the database for backward compatibility
but are **no longer the authoritative source of truth** for deletion:

- `User.isDeleted` is kept on the entity but its value is no longer
  written by service code. It is only updated to `true` if a legacy
  consumer wrote it before this change; in that case, the row is still
  treated as deleted.
- `Workspace.isActive` is kept and still respected by the public list
  endpoint. The new `deletedAt` column adds an extra, more reliable
  flavour of "deactivated".

Both columns may be removed in a later migration once we are confident
no downstream code reads them.

## API

### Public / authenticated surface

`DELETE /api/users/:id` — soft-deletes a user (admin only).

`DELETE /api/workspaces/:id` — soft-deletes a workspace
(ADMIN / SUPER_ADMIN only).

`PATCH /api/contact/messages/:id/read` and similar moderator actions
remain as before; soft-delete is exposed only through admin endpoints.

### Admin surface

| Endpoint                                 | Purpose                                                      |
|------------------------------------------|--------------------------------------------------------------|
| `GET    /api/admin/users?status=deleted` | List soft-deleted users                                       |
| `PATCH  /api/admin/users/:id/restore`    | Restore a soft-deleted user                                   |
| `GET    /api/admin/workspaces/deleted`   | List soft-deleted workspaces                                  |
| `PATCH  /api/admin/workspaces/:id/restore` | Restore a soft-deleted workspace                            |
| `GET    /api/admin/contact/deleted`      | List soft-deleted contact messages                            |
| `PATCH  /api/admin/contact/:id/restore`  | Restore a soft-deleted contact message                        |

All admin endpoints require `RolesGuard` with `ADMIN` or
`SUPER_ADMIN`. Records are restored by setting `deletedAt` back to
`null` via `Repository.restore()`.

## Migration

`synchronize: true` is enabled in `app.module.ts`, so newly added
columns are created automatically in non-production databases.

For production deployments:

1. Generate a TypeORM migration:
   `npm run typeorm:generate-migration -- src/migrations/add-soft-delete`
2. Review the generated SQL – it should add a `deletedAt` timestamp
   column with a `NULL` default and an index for fast filtering.
3. Deploy the migration **before** the new application code is
   rolled out. The new code expects the column to exist.
4. Once the column is in place, deploy the application code.

## Future work

- Consider adding a periodic background job that purges soft-deleted
  records older than the retention window.
- Replace the legacy `isDeleted` / `isActive` columns with a single
  `status` enum if/when we are confident no external consumers rely
  on them.
