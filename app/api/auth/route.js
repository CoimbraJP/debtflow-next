import { NextResponse } from 'next/server';
import { resolveLogin, createSessionToken, sessionCookieOptions, clearCookieOptions } from '@/lib/auth';

export async function POST(request) {
  const { password } = await request.json();

  await new Promise(r => setTimeout(r, 400));

  const result = await resolveLogin(password);
  if (!result) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 });
  }

  const token    = await createSessionToken(result);
  const response = NextResponse.json({ ok: true, role: result.role, tenant: result.tenant || null });
  response.cookies.set(sessionCookieOptions(token));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearCookieOptions());
  return response;
}
