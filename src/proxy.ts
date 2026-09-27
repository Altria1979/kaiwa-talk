import { NextResponse, type NextRequest } from 'next/server';
import { accessChallenge, accessCookie, accessSecret, isCloudDeployment, validAccessCookie, validBasicAuthorization } from '../shared/cloud-access';

export function proxy(request: NextRequest) {
  if (!isCloudDeployment()) return NextResponse.next();
  let secret: string;
  try { secret = accessSecret(); }
  catch { return new NextResponse('Cloud access is not configured.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  if (validAccessCookie(request.headers.get('cookie') ?? undefined, secret)) return NextResponse.next();
  if (!validBasicAuthorization(request.headers.get('authorization') ?? undefined, secret)) {
    return new NextResponse('Authentication required.', { status: 401, headers: accessChallenge });
  }
  const response = NextResponse.next();
  response.headers.set('Set-Cookie', accessCookie(secret));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
