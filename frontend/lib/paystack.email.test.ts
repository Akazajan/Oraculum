import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "./store/authStore";
import { User } from "./types/user";

describe("Paystack payment email resolution and fallback", () => {
  beforeEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it("extracts the authenticated user's email when logged in", () => {
    const mockUser: User = {
      id: "user-test-123",
      firstname: "Jane",
      lastname: "Doe",
      email: "jane.doe@example.com",
      role: "user",
      isActive: true,
      isSuspended: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    useAuthStore.getState().setUser(mockUser);
    const user = useAuthStore.getState().user;
    const email = user?.email || "";

    expect(email).toBe("jane.doe@example.com");
  });

  it("falls back to empty string when user is unauthenticated", () => {
    const user = useAuthStore.getState().user;
    const email = user?.email || "";

    expect(email).toBe("");
  });

  it("falls back to empty string when user email is empty string", () => {
    const mockUser: User = {
      id: "user-test-456",
      firstname: "No",
      lastname: "Email",
      email: "",
      role: "user",
      isActive: true,
      isSuspended: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    useAuthStore.getState().setUser(mockUser);
    const user = useAuthStore.getState().user;
    const email = user?.email || "";

    expect(email).toBe("");
  });
});
