import { NextResponse } from 'next/server';

export async function GET(request) {
  const role   = request.headers.get('x-role')   || 'admin';
  const tenant = request.headers.get('x-tenant') || 'default';

  const NAMES = { miguel: 'Miguel', loja: 'Loja' };

  return NextResponse.json({
    role,
    tenant,
    name: role === 'master' ? 'Master' : (NAMES[tenant] || tenant),
  });
}
