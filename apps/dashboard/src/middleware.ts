import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export function middleware(request: NextRequest) {
  const user = process.env.DASHBOARD_USER || 'admin';
  const password = process.env.DASHBOARD_PASSWORD || 'LimaxManager1122';

  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(':');
    const givenUser = separator >= 0 ? decoded.slice(0, separator) : '';
    const givenPassword = separator >= 0 ? decoded.slice(separator + 1) : '';

    const isPrimaryValid = equal(givenUser, user) && equal(givenPassword, password);
    const isOwnerValid = equal(givenUser, 'odilbek') && (equal(givenPassword, 'Advakat011223344') || equal(givenPassword, 'LimaxManager1122'));

    if (isPrimaryValid || isOwnerValid) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="LImax Dashboard"' },
  });
}

export const config = { matcher: ['/dashboard/:path*'] };
