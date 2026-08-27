import { User } from "./types/user";

const AUTH_TOKEN_KEY = "authToken";
const AUTH_USER_KEY = "authUser";

/**
 * NOTE (#219): Cookies set via `document.cookie` (client-side JS) are inherently
 * accessible to JavaScript and cannot be marked httpOnly from the client.
 * For full httpOnly protection the backend should set the token cookie in the
 * Set-Cookie response header. This cookie is used only for Next.js middleware
 * reads; sensitive operations use the Authorization header via apiClient.setToken().
 */
function authCookieAttributes(): string {
  const base = "; path=/; SameSite=Lax";
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  return `${base}${secure}`;
}

const EXPIRED_COOKIE = "; expires=Thu, 01 Jan 1970 00:00:01 GMT";

export const storage = {
  getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(AUTH_TOKEN_KEY);
  },

  setToken(token: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    document.cookie = `authToken=${token}; max-age=${1 * 24 * 60 * 60}${authCookieAttributes()}`;
  },

  removeToken(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    document.cookie = `authToken=${EXPIRED_COOKIE}${authCookieAttributes()}`;
  },

  getUser(): User | null {
    if (typeof window === "undefined") return null;
    const user = localStorage.getItem(AUTH_USER_KEY);
    return user ? (JSON.parse(user) as User) : null;
  },

  setUser(user: unknown): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  },

  removeUser(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(AUTH_USER_KEY);
  },

  clear(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    document.cookie = `authToken=${EXPIRED_COOKIE}${authCookieAttributes()}`;
  },
};