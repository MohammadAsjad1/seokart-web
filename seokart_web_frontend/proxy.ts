import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;
  // const sessionExpiresAt = request.cookies.get('sessionExpiresAt')?.value;
  const isHomePage = pathname === '/';

  // Redirect home page based on auth status
  if (isHomePage && !token) {
      return NextResponse.redirect(new URL('/load', request.url));
  }

  // Redirect home page based on session expiration if session is expired
  // if (isHomePage && token && sessionExpiresAt && new Date(sessionExpiresAt) < new Date()) {
  //   return NextResponse.redirect(new URL('/load', request.url));
  // }

  // // Redirect home page based on session expiration if session is not expired
  // if (isHomePage && token && sessionExpiresAt && new Date(sessionExpiresAt) > new Date()) {
  //   return NextResponse.redirect(new URL('/dashboard', request.url));
  // }

  const response = NextResponse.next();
  response.headers.set('x-middleware-cache', 'no-cache');
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
