import { describe, expect, it } from "vitest";
import type { User } from "../types/user";
import {
  canAccessPath,
  canRenderPath,
  isAccountUsable,
  isProtectedPath,
  rolesForPath,
} from "./routePolicy";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    firstname: "Ada",
    lastname: "Lovelace",
    email: "ada@example.com",
    role: "user",
    isActive: true,
    isSuspended: false,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("rolesForPath", () => {
  it("resolves the explicit matrix", () => {
    expect(rolesForPath("/admin/members")).toEqual(["admin"]);
    expect(rolesForPath("/admin")).toEqual(["admin"]);
    expect(rolesForPath("/users")).toEqual(["admin"]);
    expect(rolesForPath("/dashboard")).toEqual(["user", "admin"]);
    expect(rolesForPath("/bookings/new")).toEqual(["user", "admin"]);
  });

  it("treats unmapped paths as public", () => {
    expect(rolesForPath("/login")).toBeNull();
    expect(rolesForPath("/")).toBeNull();
    // A prefix must be a real path segment, not a shared string prefix.
    expect(rolesForPath("/adminxyz")).toBeNull();
  });

  it("reports which paths are protected", () => {
    expect(isProtectedPath("/invoices")).toBe(true);
    expect(isProtectedPath("/register")).toBe(false);
  });
});

describe("canAccessPath", () => {
  it("allows the roles named in the matrix", () => {
    expect(canAccessPath("admin", "/admin/members")).toBe(true);
    expect(canAccessPath("user", "/dashboard")).toBe(true);
  });

  it("denies roles the matrix does not name", () => {
    expect(canAccessPath("user", "/admin/members")).toBe(false);
    expect(canAccessPath(null, "/admin/members")).toBe(false);
    expect(canAccessPath(undefined, "/dashboard")).toBe(false);
  });

  it("keeps public routes reachable without a session", () => {
    expect(canAccessPath(null, "/login")).toBe(true);
  });
});

describe("isAccountUsable", () => {
  it("rejects suspended, inactive and deleted accounts", () => {
    expect(isAccountUsable(makeUser())).toBe(true);
    expect(isAccountUsable(makeUser({ isSuspended: true }))).toBe(false);
    expect(isAccountUsable(makeUser({ isActive: false }))).toBe(false);
    expect(isAccountUsable(makeUser({ isDeleted: true }))).toBe(false);
    expect(isAccountUsable(null)).toBe(false);
  });
});

describe("canRenderPath", () => {
  it("lets an admin render an admin route", () => {
    expect(canRenderPath(makeUser({ role: "admin" }), "/admin/members")).toBe(
      true
    );
  });

  it("stops a member from rendering an admin route", () => {
    expect(canRenderPath(makeUser({ role: "user" }), "/admin/members")).toBe(
      false
    );
  });

  it("stops a suspended admin from rendering an admin route", () => {
    expect(
      canRenderPath(
        makeUser({ role: "admin", isSuspended: true }),
        "/admin/members"
      )
    ).toBe(false);
  });

  it("keeps public routes renderable without a user", () => {
    expect(canRenderPath(null, "/login")).toBe(true);
  });
});
