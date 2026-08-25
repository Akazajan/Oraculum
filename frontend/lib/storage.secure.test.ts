// @vitest-environment-options { "url": "https://localhost/" }
import { describe, it, expect, beforeEach, vi } from "vitest";
import { storage } from "./storage";

// Regression coverage for the protocol-safety fix: the `authToken` cookie must
// be marked `Secure` whenever it is served over an encrypted (HTTPS) transport,
// so the session token is never sent over plain HTTP.
describe("storage.setToken cookie — secure transport (HTTPS)", () => {
  let setCookieSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    setCookieSpy = vi.spyOn(document, "cookie", "set");
  });

  it("sets a Secure, SameSite=Lax cookie on the successful path", () => {
    storage.setToken("access-token-value");

    expect(setCookieSpy).toHaveBeenCalledTimes(1);
    const cookie = setCookieSpy.mock.calls[0][0] as string;

    expect(cookie).toContain("authToken=access-token-value");
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Lax");
    // Protocol-safety: must be Secure over HTTPS.
    expect(cookie).toContain("Secure");
  });

  it("keeps the cookie Secure when clearing it (expiry/invalid path)", () => {
    storage.clear();

    expect(setCookieSpy).toHaveBeenCalledTimes(1);
    const cookie = setCookieSpy.mock.calls[0][0] as string;

    expect(cookie).toContain("authToken=");
    expect(cookie).toContain("expires=Thu, 01 Jan 1970");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });

  it("keeps the cookie Secure on removeToken (expiry/invalid path)", () => {
    storage.removeToken();

    expect(setCookieSpy).toHaveBeenCalledTimes(1);
    const cookie = setCookieSpy.mock.calls[0][0] as string;

    expect(cookie).toContain("authToken=");
    expect(cookie).toContain("expires=Thu, 01 Jan 1970");
    expect(cookie).toContain("Secure");
  });
});
