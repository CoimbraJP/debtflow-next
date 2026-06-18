import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';
import { Activity }     from '@/lib/models/Activity';

// GET /api/debts/:id
export async function GET(request, { params }) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const { id } = await params;
  const debt = await Debt.findOne({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
  return NextResponse.json(debt.toJSON());
}

// PUT /api/debts/:id — Fix 2: atualiza APENAS campos cadastrais
// Nunca recalcula parcelas, juros acumulados ou histórico financeiro
export async function PUT(request, { params }) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const { id } = await params;
  const body = await request.json();

  const debt = await Debt.findOne({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });

  // Apenas campos cadastrais — qualquer campo financeiro enviado é ignorado
  if (body.name    !== undefined) debt.name    = body.name;
  if (body.phone   !== undefined) debt.phone   = body.phone;
  if (body.address !== undefined) debt.address = body.address;
  if (body.product !== undefined) debt.product = body.product;
  if (body.notes   !== undefined) debt.notes   = body.notes;

  await debt.save();

  await Activity.create({
    tenant,
    text: `✏️ Dados atualizados: <strong>${debt.name}</strong> — ${debt.product}`,
    type: 'info',
  });

  return NextResponse.json(debt.toJSON());
}

// DELETE /api/debts/:id
export async function DELETE(request, { params }) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const { id } = await params;
  const debt = await Debt.findOneAndDelete({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });

  await Activity.create({
    tenant,
    text: `🗑️ Dívida removida: <strong>${debt.name}</strong> — ${debt.product}`,
    type: 'warning',
  });

  return NextResponse.json({ ok: true });
}
