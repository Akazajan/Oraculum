import { describe, it, expect, beforeEach, vi } from "vitest";
import { storage } from "./storage";

// Regression coverage for the non-production (plain-HTTP) path. Over an
// unencrypted transport the `Secure` flag must be omitted so the cookie remains
// usable in local development, but it must still carry `SameSite=Lax` and never
// be marked `Secure` (which would otherwise silently drop it / expose it).
describe("storage.setToken cookie — insecure transport (HTTP / dev)", () => {
  let setCookieSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    setCookieSpy = vi.spyOn(document, "cookie", "set");
  });

  it("does not mark the cookie Secure over HTTP (dev stays usable)", () => {
    storage.setToken("access-token-value");

    expect(setCookieSpy).toHaveBeenCalledTimes(1);
    const cookie = setCookieSpy.mock.calls[0][0] as string;

    expect(cookie).toContain("authToken=access-token-value");
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Lax");
    // Over HTTP the Secure flag must NOT be set.
    expect(cookie).not.toContain("Secure");
  });

  it("does not mark the cleared cookie Secure over HTTP", () => {
    storage.clear();

    expect(setCookieSpy).toHaveBeenCalledTimes(1);
    const cookie = setCookieSpy.mock.calls[0][0] as string;

    expect(cookie).toContain("authToken=");
    expect(cookie).toContain("expires=Thu, 01 Jan 1970");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });
});
