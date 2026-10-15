const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api";

export interface DownloadedFile {
  blob: Blob;
  /** Filename advertised by the server, or `null` when it did not advertise one. */
  filename: string | null;
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Reads the filename out of a `Content-Disposition` header, preferring the
 * RFC 5987 `filename*` form that servers use for non-ASCII names.
 */
export function parseContentDispositionFilename(
  header: string | null
): string | null {
  if (!header) return null;

  const extended = /filename\*\s*=\s*(?:[^']*'[^']*')?([^;]+)/i.exec(header);
  const extendedValue = decodeUriComponentSafe(
    (extended?.[1] ?? "").trim().replace(/^"|"$/g, "")
  );
  if (extendedValue) return extendedValue;

  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare?.[1]?.trim() || null;
}

/**
 * Reduces a server-supplied name to a single safe path segment, so a response can
 * never steer the browser outside the download directory, and guarantees the
 * result still looks like a PDF.
 */
export function sanitizeDownloadFilename(
  candidate: string | null | undefined,
  fallback: string
): string {
  const base = (candidate ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim();

  if (!cleaned) return fallback;

  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

/**
 * Maps a download failure status onto copy a user can act on. Kept here so every
 * caller reports an expired session the same way.
 */
export function downloadErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Your session has expired. Sign in again to download this invoice.";
  }
  if (status === 404) {
    return "This invoice is no longer available to download.";
  }
  if (status >= 500) {
    return "The server could not prepare this invoice. Please try again.";
  }
  return `Could not download this invoice (status ${status}). Please try again.`;
}

class ApiClient {
  private baseURL: string;
  private token: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const config: RequestInit = { ...options, headers };
    try {
      const response = await fetch(url, config);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as { message?: string }).message || "An API error occurred");
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error("Network error occurred");
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  async post<T, D = unknown>(endpoint: string, data?: D): Promise<T> {
    return this.request<T>(endpoint, { method: "POST", credentials: "include", body: data ? JSON.stringify(data) : undefined });
  }

  async patch<T, D = unknown>(endpoint: string, data?: D): Promise<T> {
    return this.request<T>(endpoint, { method: "PATCH", credentials: "include", body: data ? JSON.stringify(data) : undefined });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  /**
   * Downloads a binary attachment with the same Authorization header as every
   * other request, so an invoice download is never sent anonymously. The server's
   * `Content-Disposition` filename is returned untouched; sanitising it is the
   * caller's decision.
   */
  async download(endpoint: string): Promise<DownloadedFile> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await fetch(url, { method: "GET", headers });
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error occurred");
    }

    if (!response.ok) {
      throw new Error(downloadErrorMessage(response.status));
    }

    return {
      blob: await response.blob(),
      filename: parseContentDispositionFilename(
        response.headers?.get?.("content-disposition") ?? null
      ),
    };
  }
}

export const apiClient = new ApiClient(API_BASE_URL);