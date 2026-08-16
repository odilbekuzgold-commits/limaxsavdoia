import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export function middleware(request: NextRequest) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    return new NextResponse('Dashboard authentication is not configured', { status: 503 });
  }
  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(':');
    const givenUser = separator >= 0 ? decoded.slice(0, separator) : '';
    const givenPassword = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (equal(givenUser, user) && equal(givenPassword, password)) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="LImax Dashboard"' },
  });
}

export const config = { matcher: ['/dashboard/:path*'] };
