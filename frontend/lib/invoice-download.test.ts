import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiClient,
  downloadErrorMessage,
  parseContentDispositionFilename,
  sanitizeDownloadFilename,
} from "./apiClient";

interface StubResponseOptions {
  status?: number;
  disposition?: string | null;
  body?: string;
}

/** jsdom has no Fetch API, so only the surface `download` touches is reproduced. */
function stubResponse({
  status = 200,
  disposition = null,
  body = "%PDF-1.4",
}: StubResponseOptions = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-disposition" && disposition
          ? disposition
          : null,
    },
    // Duck-typed stand-in: jsdom's Blob has no `text()`.
    blob: async () => ({ size: body.length, text: async () => body }) as unknown as Blob,
    json: async () => ({}),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  apiClient.setToken("session-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiClient.setToken(null);
});

describe("parseContentDispositionFilename", () => {
  it("reads a quoted filename", () => {
    expect(
      parseContentDispositionFilename('attachment; filename="invoice-INV-42.pdf"')
    ).toBe("invoice-INV-42.pdf");
  });

  it("reads an unquoted filename", () => {
    expect(parseContentDispositionFilename("attachment; filename=plain.pdf")).toBe(
      "plain.pdf"
    );
  });

  it("prefers and decodes the RFC 5987 filename* form", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=UTF-8''receipt%20for%20March.pdf"
      )
    ).toBe("receipt for March.pdf");
  });

  it("returns null when the header carries no filename", () => {
    expect(parseContentDispositionFilename("attachment")).toBeNull();
    expect(parseContentDispositionFilename(null)).toBeNull();
  });
});

describe("sanitizeDownloadFilename", () => {
  it("keeps a plain filename and guarantees the .pdf extension", () => {
    expect(sanitizeDownloadFilename("invoice-INV-42.pdf", "fallback.pdf")).toBe(
      "invoice-INV-42.pdf"
    );
    expect(sanitizeDownloadFilename("invoice-INV-42", "fallback.pdf")).toBe(
      "invoice-INV-42.pdf"
    );
  });

  it("refuses to climb out of the download directory", () => {
    expect(sanitizeDownloadFilename("../../etc/passwd", "fallback.pdf")).toBe(
      "passwd.pdf"
    );
    expect(sanitizeDownloadFilename("..\\..\\windows\\system32\\cfg", "fallback.pdf")).toBe(
      "cfg.pdf"
    );
    expect(sanitizeDownloadFilename("..", "fallback.pdf")).toBe("fallback.pdf");
  });

  it("strips characters that browsers or filesystems reject", () => {
    expect(sanitizeDownloadFilename('inv"oi<>ce|?.pdf', "fallback.pdf")).toBe(
      "invoice.pdf"
    );
  });

  it("falls back when the server sends nothing usable", () => {
    expect(sanitizeDownloadFilename(null, "fallback.pdf")).toBe("fallback.pdf");
    expect(sanitizeDownloadFilename("   ", "fallback.pdf")).toBe("fallback.pdf");
  });
});

describe("downloadErrorMessage", () => {
  it("reports an expired session for 401 and 403", () => {
    expect(downloadErrorMessage(401)).toMatch(/session has expired/i);
    expect(downloadErrorMessage(403)).toMatch(/session has expired/i);
  });

  it("reports an unavailable document for 404", () => {
    expect(downloadErrorMessage(404)).toMatch(/no longer available/i);
  });

  it("reports a server problem for 5xx", () => {
    expect(downloadErrorMessage(503)).toMatch(/could not prepare/i);
  });

  it("still names the status for anything else", () => {
    expect(downloadErrorMessage(418)).toContain("418");
  });
});

describe("apiClient.download", () => {
  it("sends the bearer token and returns the blob with the server filename", async () => {
    fetchMock.mockResolvedValueOnce(
      stubResponse({
        disposition: 'attachment; filename="invoice-INV-42.pdf"',
        body: "%PDF-1.4 payload",
      })
    );

    const result = await apiClient.download("/invoices/inv-42/download");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/invoices/inv-42/download");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer session-token",
    });
    expect(result.filename).toBe("invoice-INV-42.pdf");
    expect(await result.blob.text()).toBe("%PDF-1.4 payload");
  });

  it("surfaces an expired session instead of returning the login page", async () => {
    fetchMock.mockResolvedValueOnce(stubResponse({ status: 401 }));

    await expect(apiClient.download("/invoices/inv-42/download")).rejects.toThrow(
      /session has expired/i
    );
  });

  it("surfaces an unavailable document", async () => {
    fetchMock.mockResolvedValueOnce(stubResponse({ status: 404 }));

    await expect(apiClient.download("/invoices/gone/download")).rejects.toThrow(
      /no longer available/i
    );
  });
});
