import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/mongodb';
import { Tenant } from '@/lib/models/Tenant';

function masterOnly(request) {
  if (request.headers.get('x-role') !== 'master') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }
  return null;
}

// PUT /api/admin/tenants/[id] — editar nome e/ou senha
export async function PUT(request, { params }) {
  const deny = masterOnly(request);
  if (deny) return deny;

  const { name, password } = await request.json();
  const { id } = await params;

  await connectDB();
  const doc = await Tenant.findById(id);
  if (!doc) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });

  if (name)     doc.name         = name;
  if (password) doc.passwordHash = await bcrypt.hash(password, 10);
  await doc.save();

  return NextResponse.json({ ok: true, tenant: doc.tenant, name: doc.name });
}

// DELETE /api/admin/tenants/[id]
export async function DELETE(request, { params }) {
  const deny = masterOnly(request);
  if (deny) return deny;

  const { id } = await params;
  await connectDB();
  const doc = await Tenant.findByIdAndDelete(id);
  if (!doc) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
