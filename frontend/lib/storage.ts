import { User } from "./types/user";

const AUTH_TOKEN_KEY = "authToken";
const AUTH_USER_KEY = "authUser";

// The `authToken` cookie is read by Next.js middleware (server-side) to authorize
// requests. It must only be transmitted over an encrypted transport, so it is
// marked `Secure` whenever the page is served over HTTPS. On plain-HTTP origins
// (e.g. local development) the flag is omitted so the cookie remains usable, but
// it is never exposed over an unencrypted connection in production. `SameSite=Lax`
// is set to mitigate CSRF while still permitting same-site navigations/fetch.
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
    // set the token to cookie as well for middleware access
    document.cookie = `authToken=${token}; max-age=${1 * 24 * 60 * 60}${authCookieAttributes()}`; // 1 day - Access Token
  },

  removeToken(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    document.cookie = `authToken=${EXPIRED_COOKIE}${authCookieAttributes()}`;
  },

  getUser(): User | null {
    if (typeof window === "undefined") return null;
    const user = localStorage.getItem(AUTH_USER_KEY);
    return user ? JSON.parse(user) : null;
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
