import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Cron job protegido por Bearer token, não por cookie
  if (pathname === '/api/cron/scheduler') {
    const authHeader = request.headers.get('authorization');
    const expected   = `Bearer ${process.env.CRON_SECRET}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Rotas públicas
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Verificar cookie de sessão
  const token = request.cookies.get('df_session')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const secret = new TextEncoder().encode(
      process.env.SESSION_SECRET || 'fallback-dev-secret-troque-em-producao'
    );
    const { payload } = await jwtVerify(token, secret);

    // Propaga o tenant como header para todas as API routes
    const tenant = payload.tenant || 'default';
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-tenant', tenant);

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 });
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('df_session');
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
