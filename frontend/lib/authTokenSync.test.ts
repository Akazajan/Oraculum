import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./apiClient";
import { bindApiClientToAuthStore, useAuthStore } from "./store/authStore";

let fetchMock: ReturnType<typeof vi.fn>;
let unbind: (() => void) | undefined;

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: "",
    headers: { get: () => null },
    json: async () => ({ ok: true }),
    text: async () => "",
  } as unknown as Response;
}

/** Reads the Authorization header of the most recent fetch call. */
function lastAuthHeader(): string | undefined {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const init = call?.[1] as RequestInit | undefined;
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);
  useAuthStore.setState({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
  });
  apiClient.setToken(null);
  unbind = bindApiClientToAuthStore();
});

afterEach(() => {
  unbind?.();
  unbind = undefined;
  vi.unstubAllGlobals();
});

describe("bindApiClientToAuthStore (FE-04)", () => {
  it("gives the API client the token as soon as the store has one", async () => {
    useAuthStore.setState({ accessToken: "session-token" });

    await apiClient.get("/workspaces");

    expect(lastAuthHeader()).toBe("Bearer session-token");
  });

  it("applies a token that was already in the store when binding", async () => {
    unbind?.();
    useAuthStore.setState({ accessToken: "persisted-token" });

    unbind = bindApiClientToAuthStore();
    await apiClient.get("/workspaces");

    expect(lastAuthHeader()).toBe("Bearer persisted-token");
  });

  it("clears the header on logout so a new session cannot inherit it", async () => {
    useAuthStore.setState({ accessToken: "first-session" });
    useAuthStore.getState().logout();

    await apiClient.get("/workspaces");

    expect(lastAuthHeader()).toBeUndefined();
  });

  it("stops following the store once unbound", async () => {
    unbind?.();
    unbind = undefined;

    useAuthStore.setState({ accessToken: "late-token" });
    await apiClient.get("/workspaces");

    expect(lastAuthHeader()).toBeUndefined();
  });
});
