import type { User } from "@/lib/types/user";

/**
 * The role values the backend issues. Deriving the type from `User` keeps this
 * module and the API contract from drifting apart.
 */
export type CanonicalRole = User["role"];

export interface RoutePolicyEntry {
  /** Path prefix this entry governs. */
  prefix: string;
  /** Roles allowed to reach it. */
  roles: readonly CanonicalRole[];
}

/**
 * Canonical route → role policy, shared by the edge middleware and the client so
 * the two layers can never disagree about who may reach what.
 *
 * Rules:
 * - the first matching entry wins, so longer prefixes must be listed first;
 * - a path that matches no entry is public;
 * - only the roles named here are authorised — this is the explicit matrix.
 */
export const ROUTE_POLICY: readonly RoutePolicyEntry[] = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/users", roles: ["admin"] },
  { prefix: "/dashboard", roles: ["user", "admin"] },
  { prefix: "/profile", roles: ["user", "admin"] },
  { prefix: "/settings", roles: ["user", "admin"] },
  { prefix: "/workspaces", roles: ["user", "admin"] },
  { prefix: "/bookings", roles: ["user", "admin"] },
  { prefix: "/invoices", roles: ["user", "admin"] },
  { prefix: "/check-in", roles: ["user", "admin"] },
  { prefix: "/notifications", roles: ["user", "admin"] },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Roles allowed on `pathname`, or `null` when the route is public. */
export function rolesForPath(pathname: string): readonly CanonicalRole[] | null {
  for (const entry of ROUTE_POLICY) {
    if (matchesPrefix(pathname, entry.prefix)) return entry.roles;
  }
  return null;
}

export function isProtectedPath(pathname: string): boolean {
  return rolesForPath(pathname) !== null;
}

/** Role-only check, for callers that already know the account is usable. */
export function canAccessPath(
  role: CanonicalRole | null | undefined,
  pathname: string
): boolean {
  const roles = rolesForPath(pathname);
  if (!roles) return true;
  if (!role) return false;
  return roles.includes(role);
}

/** A suspended or deleted account may not reach any protected route. */
export function isAccountUsable(
  user: Pick<User, "isActive" | "isSuspended" | "isDeleted"> | null | undefined
): boolean {
  if (!user) return false;
  return user.isActive && !user.isSuspended && !user.isDeleted;
}

/**
 * The full policy check used by components: public routes are always reachable,
 * protected routes need an active account whose role appears in the matrix.
 */
export function canRenderPath(
  user: User | null | undefined,
  pathname: string
): boolean {
  const roles = rolesForPath(pathname);
  if (!roles) return true;
  if (!isAccountUsable(user)) return false;
  return roles.includes(user!.role);
}
