import { NextResponse } from 'next/server';
import { resolveTenant, createSessionToken, sessionCookieOptions, clearCookieOptions } from '@/lib/auth';

// POST /api/auth — Login (suporta múltiplos tenants via senhas distintas)
export async function POST(request) {
  const { password } = await request.json();

  // Delay mínimo para dificultar brute-force
  await new Promise(r => setTimeout(r, 400));

  const tenant = resolveTenant(password);
  if (!tenant) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 });
  }

  const token    = await createSessionToken(tenant);
  const response = NextResponse.json({ ok: true, tenant });
  response.cookies.set(sessionCookieOptions(token));
  return response;
}

// DELETE /api/auth — Logout
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearCookieOptions());
  return response;
}
