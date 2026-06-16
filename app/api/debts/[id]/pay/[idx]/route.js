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

  const inst       = debt.installmentList[i];
  const dueValue   = parseFloat(inst.value) || 0;
  const payAmount  = body.payAmount && body.payAmount > 0 ? parseFloat(body.payAmount) : dueValue;
  const isPartial  = payAmount < dueValue - 0.009; // tolerância de 1 centavo

  inst.status     = 'paid';
  inst.paidDate   = payDate;
  inst.paidAmount = payAmount;

  // Se pagamento parcial, adiciona saldo restante + juros à próxima parcela
  if (isPartial) {
    const remainder    = dueValue - payAmount;
    const interestRate = parseFloat(debt.interestRate) || 0;
    const penalty      = remainder * (1 + interestRate / 100);

    // Encontra a próxima parcela não paga
    const nextInst = debt.installmentList.find((p, j) => j > i && p.status !== 'paid');
    if (nextInst) {
      nextInst.value     = parseFloat(nextInst.value) + parseFloat(penalty.toFixed(2));
      nextInst.isPenalty = true;
    }
  }

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
    const desc = isPartial
      ? `💰 Pagamento parcial: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} (pago R$ ${payAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de R$ ${dueValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
      : `💰 Pagamento registrado: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} (R$ ${dueValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
    await Activity.create({ tenant, text: desc, type: 'success' });
  }

  await debt.save();
  return NextResponse.json(debt.toJSON());
}
