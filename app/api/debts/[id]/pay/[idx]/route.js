import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';
import { Activity }     from '@/lib/models/Activity';

// POST /api/debts/:id/pay/:idx — Registrar pagamento de parcela
export async function POST(request, { params }) {
  await connectDB();
  const tenant   = request.headers.get('x-tenant') || 'default';
  const { id, idx } = await params;
  const body     = await request.json();
  const payDate  = body.payDate || new Date().toISOString().slice(0, 10);

  const debt = await Debt.findOne({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Dívida não encontrada' }, { status: 404 });

  const i = parseInt(idx);
  if (i < 0 || i >= debt.installmentList.length) {
    return NextResponse.json({ error: 'Parcela não encontrada' }, { status: 404 });
  }

  const inst    = debt.installmentList[i];
  inst.status   = 'paid';
  inst.paidDate = payDate;

  const allPaid = debt.installmentList.every(p => p.status === 'paid');
  if (allPaid) {
    debt.status = 'paid';
    await Activity.create({
      tenant,
      text: `✅ Dívida quitada: <strong>${debt.name}</strong> — ${debt.product}`,
      type: 'success',
    });
  } else {
    debt.status = 'pending';
    await Activity.create({
      tenant,
      text: `💰 Pagamento registrado: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} (R$ ${Number(inst.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
      type: 'success',
    });
  }

  await debt.save();
  return NextResponse.json(debt.toJSON());
}
