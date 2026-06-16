import { NextResponse } from 'next/server';

// GET /api/me — Retorna o tenant da sessão atual (lido do header injetado pelo middleware)
export async function GET(request) {
  const tenant = request.headers.get('x-tenant') || 'default';

  const NAMES = {
    miguel: 'Miguel',
    loja:   'Loja',
  };

  return NextResponse.json({
    tenant,
    name: NAMES[tenant] || 'Administrador',
  });
}
