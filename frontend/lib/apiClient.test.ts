import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient, parseApiError } from "./apiClient";

interface MockResponseOptions {
  status?: number;
  statusText?: string;
  contentType?: string;
  body?: string;
  jsonBody?: unknown;
}

/**
 * Minimal stand-in for `Response`. jsdom does not ship the Fetch API, so only
 * the surface `apiClient` actually touches is reproduced here.
 */
function mockResponse({
  status = 200,
  statusText = "",
  contentType = "application/json",
  body = "",
  jsonBody,
}: MockResponseOptions = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    },
    text: async () => body,
    json: async () => (jsonBody !== undefined ? jsonBody : JSON.parse(body)),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  apiClient.setToken(null);
  apiClient.configureAuth(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseApiError — every response-content variant (FE-01)", () => {
  it("preserves status, code and message from a JSON body", async () => {
    const error = await parseApiError(
      mockResponse({
        status: 409,
        body: '{"message":"Email already registered","code":"EMAIL_TAKEN"}',
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(409);
    expect(error.code).toBe("EMAIL_TAKEN");
    expect(error.message).toBe("Email already registered");
    expect(error.serverMessage).toBe("Email already registered");
  });

  it("joins the array messages produced by validation pipes", async () => {
    const error = await parseApiError(
      mockResponse({
        status: 400,
        body: JSON.stringify({
          statusCode: 400,
          message: ["email must be an email", "password is too short"],
          error: "Bad Request",
        }),
      }),
    );

    expect(error.status).toBe(400);
    expect(error.code).toBeNull();
    expect(error.message).toBe("email must be an email password is too short");
  });

  it("uses a plain-text body as the message", async () => {
    const error = await parseApiError(
      mockResponse({
        status: 503,
        contentType: "text/plain; charset=utf-8",
        body: "Service Unavailable",
      }),
    );

    expect(error.status).toBe(503);
    expect(error.code).toBeNull();
    expect(error.message).toBe("Service Unavailable");
  });

  it("falls back to a status message when the body is empty", async () => {
    const error = await parseApiError(mockResponse({ status: 500, body: "" }));

    expect(error.status).toBe(500);
    expect(error.serverMessage).toBeNull();
    expect(error.message).toBe("The server encountered an unexpected error.");
  });

  it("ignores a malformed JSON body", async () => {
    const error = await parseApiError(mockResponse({ status: 400, body: '{"message":' }));

    expect(error.status).toBe(400);
    expect(error.serverMessage).toBeNull();
    expect(error.message).toBe("The request was rejected by the server.");
  });

  it("does not surface a long HTML error page as the message", async () => {
    const html = `<html><body><h1>502 Bad Gateway</h1>${"x".repeat(600)}</body></html>`;

    const error = await parseApiError(
      mockResponse({ status: 502, contentType: "text/html", body: html }),
    );

    expect(error.status).toBe(502);
    expect(error.serverMessage).toBeNull();
    expect(error.message).toBe("The server returned an invalid response.");
    expect(error.message).not.toContain("<html>");
  });

  it("falls back to the status text when the server sends no message", async () => {
    const error = await parseApiError(
      mockResponse({ status: 418, statusText: "I'm a teapot", body: "" }),
    );

    expect(error.message).toBe("I'm a teapot");
  });

  it("keeps the decoded payload available on the error", async () => {
    const payload = { message: "Nope", code: "FORBIDDEN", details: { id: 7 } };

    const error = await parseApiError(
      mockResponse({ status: 403, body: JSON.stringify(payload) }),
    );

    expect(error.data).toEqual(payload);
  });

  it("rejects the request with the typed error so callers can branch on status", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 401, body: '{"message":"Invalid credentials"}' }),
    );

    await expect(apiClient.post("/auth/login", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Invalid credentials",
    });
  });
});

describe("apiClient 401 refresh flow (FE-03)", () => {
  it("shares one refresh between concurrent 401s and replays safe requests", async () => {
    apiClient.setToken("expired-token");
    const refreshToken = vi.fn(async () => {
      await apiClient.postWithoutRefresh("/auth/refresh-token");
    });
    apiClient.configureAuth({ refreshToken });

    let workspaceCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/auth/refresh-token")) {
        // Keep the single refresh in flight so both 401 handlers observe it.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return mockResponse({
          status: 200,
          jsonBody: { accessToken: "fresh", user: {} },
        });
      }
      if (url.endsWith("/workspaces")) {
        workspaceCalls += 1;
        if (workspaceCalls <= 2) {
          return mockResponse({ status: 401, body: '{"message":"token expired"}' });
        }
        return mockResponse({ status: 200, jsonBody: { success: true, data: [] } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const [first, second] = await Promise.all([
      apiClient.get<{ success: boolean }>("/workspaces"),
      apiClient.get<{ success: boolean }>("/workspaces"),
    ]);

    expect(first).toEqual({ success: true, data: [] });
    expect(second).toEqual({ success: true, data: [] });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(workspaceCalls).toBe(4); // two original attempts + two replays
  });

  it("refreshes but never replays a mutation", async () => {
    apiClient.setToken("expired-token");
    const refreshToken = vi.fn(async () => {
      await apiClient.postWithoutRefresh("/auth/refresh-token");
    });
    apiClient.configureAuth({ refreshToken });

    let bookingCalls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh-token")) {
        return mockResponse({
          status: 200,
          jsonBody: { accessToken: "fresh", user: {} },
        });
      }
      if (url.endsWith("/bookings") && init?.method === "POST") {
        bookingCalls += 1;
        return mockResponse({ status: 401, body: '{"message":"token expired"}' });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    });

    await expect(apiClient.post("/bookings", { seats: 2 })).rejects.toMatchObject({
      status: 401,
    });

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(bookingCalls).toBe(1); // the POST was never replayed
  });

  it("clears the session and notifies the app when the refresh fails", async () => {
    apiClient.setToken("expired-token");
    const onRefreshFailed = vi.fn();
    const refreshToken = vi.fn().mockRejectedValue(new Error("refresh revoked"));
    apiClient.configureAuth({ refreshToken, onRefreshFailed });

    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 401, body: '{"message":"token expired"}' }),
    );

    await expect(apiClient.get("/dashboard/stats")).rejects.toMatchObject({
      status: 401,
    });

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(onRefreshFailed).toHaveBeenCalledTimes(1);
  });

  it("stops after one replay when the refreshed token is still rejected", async () => {
    apiClient.setToken("expired-token");
    const refreshToken = vi.fn(async () => {
      await apiClient.postWithoutRefresh("/auth/refresh-token");
    });
    apiClient.configureAuth({ refreshToken });

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/auth/refresh-token")) {
        return mockResponse({
          status: 200,
          jsonBody: { accessToken: "fresh", user: {} },
        });
      }
      return mockResponse({ status: 401, body: '{"message":"token expired"}' });
    });

    await expect(apiClient.get("/workspaces")).rejects.toMatchObject({ status: 401 });
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it("never routes the refresh request back through the 401 flow", async () => {
    const refreshToken = vi.fn();
    apiClient.configureAuth({ refreshToken });

    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 401, body: '{"message":"refresh token revoked"}' }),
    );

    await expect(
      apiClient.postWithoutRefresh("/auth/refresh-token"),
    ).rejects.toMatchObject({ status: 401 });

    expect(refreshToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a refresh when no handler is registered", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 401, body: "" }));

    await expect(apiClient.get("/workspaces")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
