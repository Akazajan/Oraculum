/**
 * Frontend environment configuration.
 *
 * `NEXT_PUBLIC_*` variables must be read through *static* property access
 * (`process.env.NEXT_PUBLIC_API_URL`). Next.js replaces those expressions with
 * literal values while bundling the client; dynamic access such as
 * `process.env[key]` is left untouched by the compiler and therefore always
 * evaluates to `undefined` in the browser.
 */

/** Raised when required build-time configuration is missing or unusable. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export const API_URL_ENV_VAR = "NEXT_PUBLIC_API_URL";

/**
 * Development-only default. Production builds never fall back to it: a missing
 * `NEXT_PUBLIC_API_URL` is a configuration error rather than a silent redirect
 * of live traffic to a developer machine.
 */
export const DEV_API_URL = "http://localhost:3000/api";

const MISSING_API_URL_MESSAGE =
  `${API_URL_ENV_VAR} is not set. Provide the public base URL of the backend API ` +
  `(for example https://api.oraculum.app). It may only be omitted outside production, ` +
  `where it defaults to ${DEV_API_URL}.`;

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Resolves the backend API base URL.
 *
 * - a configured value always wins (trailing slashes are trimmed),
 * - otherwise development and test builds fall back to {@link DEV_API_URL},
 * - production throws {@link ConfigurationError} so the misconfiguration is
 *   surfaced at startup instead of sending requests to localhost.
 */
export function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (configured) {
    return stripTrailingSlashes(configured);
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_API_URL;
  }

  throw new ConfigurationError(MISSING_API_URL_MESSAGE);
}

/**
 * Validated environment. Reading this module validates the configuration at
 * startup, before any request can be issued.
 */
export const env = {
  NEXT_PUBLIC_API_URL: resolveApiBaseUrl(),
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? "Oraculum",
  NODE_ENV: process.env.NODE_ENV ?? "development",
} as const;
