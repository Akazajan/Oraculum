import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_URL_ENV_VAR,
  ConfigurationError,
  DEV_API_URL,
  resolveApiBaseUrl,
} from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveApiBaseUrl (FE-02)", () => {
  it("uses the configured URL and trims trailing slashes", () => {
    vi.stubEnv(API_URL_ENV_VAR, "https://api.oraculum.app/api/");

    expect(resolveApiBaseUrl()).toBe("https://api.oraculum.app/api");
  });

  it("keeps local development working through the documented default", () => {
    vi.stubEnv(API_URL_ENV_VAR, "");
    vi.stubEnv("NODE_ENV", "development");

    expect(resolveApiBaseUrl()).toBe(DEV_API_URL);
  });

  it("treats a whitespace-only value as missing", () => {
    vi.stubEnv(API_URL_ENV_VAR, "   ");
    vi.stubEnv("NODE_ENV", "test");

    expect(resolveApiBaseUrl()).toBe(DEV_API_URL);
  });

  it("fails fast in production when the URL is missing", () => {
    vi.stubEnv(API_URL_ENV_VAR, "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => resolveApiBaseUrl()).toThrow(ConfigurationError);
    expect(() => resolveApiBaseUrl()).toThrow(/NEXT_PUBLIC_API_URL is not set/);
  });

  it("accepts a configured URL in production", () => {
    vi.stubEnv(API_URL_ENV_VAR, "https://api.oraculum.app");
    vi.stubEnv("NODE_ENV", "production");

    expect(resolveApiBaseUrl()).toBe("https://api.oraculum.app");
  });
});
