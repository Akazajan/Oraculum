import { env } from "../utils/env";

/**
 * HTTP methods that may be replayed after a token refresh. Everything else
 * (POST/PATCH/PUT/DELETE) is surfaced to the caller instead, because a mutation
 * that already reached the server must never be executed twice.
 */
const REPLAYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Bodies longer than this are treated as markup, not as a user-facing message. */
const MAX_TEXT_MESSAGE_LENGTH = 500;

const DEFAULT_STATUS_MESSAGES: Record<number, string> = {
  400: "The request was rejected by the server.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to perform this action.",
  404: "The requested resource was not found.",
  409: "The request conflicts with the current state of the resource.",
  422: "The submitted data is invalid.",
  429: "Too many requests. Please try again in a moment.",
  500: "The server encountered an unexpected error.",
  502: "The server returned an invalid response.",
  503: "The service is temporarily unavailable.",
};

export interface ApiErrorInit {
  status: number;
  /** Machine-readable code supplied by the server, or `null` when absent. */
  code: string | null;
  /** Message to display; falls back to a status-derived default. */
  message: string;
  /** Message exactly as sent by the server, or `null` when the body carried none. */
  serverMessage: string | null;
  /** Parsed error payload, when the response body was JSON. */
  data?: unknown;
}

/**
 * Typed transport error. Because it extends `Error`, existing
 * `err instanceof Error ? err.message` call sites keep working while new code
 * can branch on `status`/`code`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly serverMessage: string | null;
  readonly data?: unknown;

  constructor({ status, code, message, serverMessage, data }: ApiErrorInit) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
    this.data = data;
  }
}

export interface AuthRefreshHandlers {
  /**
   * Performs exactly one token refresh. Resolves once the new access token is
   * installed and rejects when the session cannot be renewed.
   */
  refreshToken: () => Promise<void>;
  /** Invoked when a refresh attempt fails, so the app can clear state and route to login. */
  onRefreshFailed?: (error: unknown) => void;
}

interface RequestOptions extends RequestInit {
  /**
   * Opts a request out of the 401 refresh flow. Used by the refresh request
   * itself so a rejected refresh can never recurse into another refresh.
   */
  skipAuthRefresh?: boolean;
}

/** Collapses Nest's `string | string[]` validation messages into one string. */
function normalizeMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.join(" ") : null;
  }

  return null;
}

function normalizeCode(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function defaultErrorMessage(status: number, statusText: string): string {
  const text = statusText.trim();
  if (text.length > 0) return text;
  return DEFAULT_STATUS_MESSAGES[status] ?? `Request failed with status ${status}`;
}

function readBodyText(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

/**
 * Builds a typed {@link ApiError} from a failed response, preserving the HTTP
 * status plus any `code`/`message` the server sent, whether the body is JSON,
 * plain text, or empty.
 */
export async function parseApiError(response: Response): Promise<ApiError> {
  const status = response.status;
  const contentType = response.headers?.get?.("content-type") ?? "";
  const rawBody = await readBodyText(response);
  const body = rawBody.trim();

  let data: unknown = undefined;
  let payload: Record<string, unknown> | null = null;
  let parsedJson = false;

  const looksLikeJson =
    contentType.includes("json") || body.startsWith("{") || body.startsWith("[");

  if (body.length > 0 && looksLikeJson) {
    parsedJson = true;
    try {
      const parsed: unknown = JSON.parse(body);
      data = parsed;
      if (Array.isArray(parsed)) {
        payload = { message: parsed };
      } else if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }

  // Only bodies that were never decoded as JSON are used verbatim; otherwise a
  // malformed JSON body would be shown to the user as raw text.
  const textBody =
    !parsedJson && body.length > 0 && body.length <= MAX_TEXT_MESSAGE_LENGTH
      ? body
      : null;

  const serverMessage =
    normalizeMessage(payload?.message) ??
    normalizeMessage(payload?.detail) ??
    normalizeMessage(payload?.error) ??
    textBody;

  return new ApiError({
    status,
    code: normalizeCode(payload?.code, payload?.errorCode),
    serverMessage,
    message: serverMessage ?? defaultErrorMessage(status, response.statusText ?? ""),
    data,
  });
}

class ApiClient {
  private baseURL: string;
  private token: string | null = null;
  private refreshHandlers: AuthRefreshHandlers | null = null;
  private refreshInFlight: Promise<void> | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  /**
   * Registers the auth layer used by the 401 flow. Pass `null` to detach, for
   * example when the provider unmounts.
   */
  configureAuth(handlers: AuthRefreshHandlers | null) {
    this.refreshHandlers = handlers;
    if (!handlers) this.refreshInFlight = null;
  }

  private isReplayable(method?: string): boolean {
    return REPLAYABLE_METHODS.has((method ?? "GET").toUpperCase());
  }

  /**
   * Single-flight refresh: concurrent 401s await the same attempt, so a burst of
   * expired requests triggers exactly one refresh call.
   */
  private refreshOnce(): Promise<void> {
    if (!this.refreshInFlight) {
      const handlers = this.refreshHandlers;
      if (!handlers) return Promise.reject(new Error("No refresh handler registered"));

      this.refreshInFlight = Promise.resolve()
        .then(() => handlers.refreshToken())
        .finally(() => {
          this.refreshInFlight = null;
        });
    }

    return this.refreshInFlight;
  }

  private async replayAfterRefresh<T>(
    endpoint: string,
    options: RequestOptions,
    attempt: number,
  ): Promise<{ value: T } | null> {
    if (!this.refreshHandlers || attempt >= 1) return null;

    try {
      await this.refreshOnce();
    } catch (refreshError) {
      this.refreshHandlers.onRefreshFailed?.(refreshError);
      return null;
    }

    // Mutations may already have been applied by the server, so only replayable
    // requests are retried and the rest surface the original 401.
    if (!this.isReplayable(options.method)) return null;

    return { value: await this.request<T>(endpoint, options, attempt + 1) };
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
    attempt = 0,
  ): Promise<T> {
    const { skipAuthRefresh, ...init } = options;
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (error) {
      // Transport-level failure: there is no HTTP status to preserve.
      throw error instanceof Error ? error : new Error("Network error occurred");
    }

    if (!response.ok) {
      const error = await parseApiError(response);

      if (error.status === 401 && !skipAuthRefresh) {
        const replayed = await this.replayAfterRefresh<T>(endpoint, options, attempt);
        if (replayed) return replayed.value;
      }

      throw error;
    }

    return (await response.json()) as T;
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  async post<T, D = unknown>(endpoint: string, data?: D): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      credentials: "include",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T, D = unknown>(endpoint: string, data?: D): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      credentials: "include",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  /**
   * `post` that never participates in the 401 refresh flow. Reserved for the
   * refresh endpoint itself, so a rejected refresh cannot trigger another one.
   */
  async postWithoutRefresh<T, D = unknown>(endpoint: string, data?: D): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      credentials: "include",
      body: data ? JSON.stringify(data) : undefined,
      skipAuthRefresh: true,
    });
  }
}

export const apiClient = new ApiClient(env.NEXT_PUBLIC_API_URL);
