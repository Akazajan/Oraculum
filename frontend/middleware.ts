import { NextRequest, NextResponse } from "next/server";
import { isProtectedPath } from "@/lib/auth/routePolicy";

const publicRoutes = ["/", "/login", "/register", "/forgot-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("authToken")?.value;
  const isPublicRoute = publicRoutes.includes(pathname);

  if (isPublicRoute) {
    // An authenticated visitor has no business on the sign-in/registration pages.
    if (token && (pathname === "/login" || pathname === "/register")) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // Which paths are private comes from the canonical policy, so middleware and
  // components cannot disagree about it.
  if (isProtectedPath(pathname) && !token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role enforcement stays in the components: the JWT payload is not decoded
  // here. `lib/auth/routePolicy` is the matrix both layers read from.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
