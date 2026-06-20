import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';

// PATCH /api/debts/:id/installments/:idx — Atualiza juros manuais de uma parcela
export async function PATCH(request, { params }) {
  await connectDB();
  const tenant      = request.headers.get('x-tenant') || 'default';
  const { id, idx } = await params;
  const body        = await request.json();

  const debt = await Debt.findOne({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });

  const i = parseInt(idx);
  if (i < 0 || i >= debt.installmentList.length) {
    return NextResponse.json({ error: 'Parcela não encontrada' }, { status: 404 });
  }

  // Apenas manualInterest pode ser alterado por esta rota
  const manual = parseFloat(body.manualInterest);
  if (!isNaN(manual)) {
    debt.installmentList[i].manualInterest = Math.max(0, parseFloat(manual.toFixed(2)));
  }

  await debt.save();
  return NextResponse.json(debt.toJSON());
}
