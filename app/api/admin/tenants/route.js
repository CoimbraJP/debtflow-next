import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/mongodb';
import { Tenant } from '@/lib/models/Tenant';

function masterOnly(request) {
  const role = request.headers.get('x-role');
  if (role !== 'master') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }
  return null;
}

// GET /api/admin/tenants
export async function GET(request) {
  const deny = masterOnly(request);
  if (deny) return deny;

  await connectDB();
  const tenants = await Tenant.find({}).sort({ createdAt: 1 }).lean();
  return NextResponse.json(tenants.map(t => ({
    _id: t._id, tenant: t.tenant, name: t.name, createdAt: t.createdAt,
  })));
}

// POST /api/admin/tenants — criar novo tenant
export async function POST(request) {
  const deny = masterOnly(request);
  if (deny) return deny;

  const { tenant, name, password } = await request.json();

  if (!tenant || !name || !password) {
    return NextResponse.json({ error: 'tenant, name e password são obrigatórios' }, { status: 400 });
  }
  if (!/^[a-z0-9_]+$/.test(tenant)) {
    return NextResponse.json({ error: 'tenant: somente letras minúsculas, números e _' }, { status: 400 });
  }

  await connectDB();
  const exists = await Tenant.findOne({ tenant: tenant.toLowerCase() });
  if (exists) {
    return NextResponse.json({ error: 'Tenant já existe' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const doc = await Tenant.create({ tenant: tenant.toLowerCase(), name, passwordHash });

  return NextResponse.json({ ok: true, _id: doc._id, tenant: doc.tenant, name: doc.name }, { status: 201 });
}
