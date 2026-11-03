import { NextRequest, NextResponse } from "next/server";

// Without a session cookie, pages redirect to /login and API calls get 401. This only checks that
// the cookie exists; every route handler validates the session itself (lib/auth.ts requireAuth).
const SESSION_COOKIE = "marr_session";
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
