import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';
import { Activity }     from '@/lib/models/Activity';

// POST /api/debts/:id/pay/:idx — Registrar pagamento de parcela
export async function POST(request, { params }) {
  await connectDB();
  const tenant      = request.headers.get('x-tenant') || 'default';
  const { id, idx } = await params;
  const body        = await request.json();
  const payDate     = body.payDate || new Date().toISOString().slice(0, 10);

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

  inst.status     = isPartial ? 'partial' : 'paid';
  inst.paidDate   = payDate;
  inst.paidAmount = payAmount;

  // Pagamento parcial: saldo restante + juros transferidos para a próxima parcela
  // Fórmula: saldo = (valorDevido - valorPago); carry = saldo * (1 + taxa/100)
  // Apenas o juro (saldo * taxa/100) é rastreado em carriedInterest na próxima parcela
  if (isPartial) {
    const remainder      = dueValue - payAmount;
    const interestRate   = parseFloat(debt.interestRate) || 0;
    const interestPart   = parseFloat((remainder * interestRate / 100).toFixed(2));
    const carry          = parseFloat((remainder + interestPart).toFixed(2));

    inst.dueSent        = true;
    inst.overdueSent    = true;
    inst.penaltyApplied = true;

    // Carrega TODOS os juros acumulados (novos + anteriores) para a próxima parcela
    const totalInterestToCarry = parseFloat((interestPart + (inst.carriedInterest || 0)).toFixed(2));

    const nextInst = debt.installmentList.find((p, j) => j > i && !['paid', 'partial', 'skipped'].includes(p.status));
    if (nextInst) {
      nextInst.value           = parseFloat((parseFloat(nextInst.value) + carry).toFixed(2));
      nextInst.isPenalty       = true;
      nextInst.carriedInterest = parseFloat(((nextInst.carriedInterest || 0) + totalInterestToCarry).toFixed(2));
    }
  }

  // Dívida quitada se todas as parcelas estiverem em estado final
  const allSettled = debt.installmentList.every(p => ['paid', 'partial', 'skipped'].includes(p.status));
  if (allSettled) {
    debt.status = 'paid';
    await Activity.create({
      tenant,
      text: `✅ Dívida quitada: <strong>${debt.name}</strong> — ${debt.product}`,
      type: 'success',
    });
  } else {
    const hasOverdue   = debt.installmentList.some(p => p.status === 'overdue' || p.status === 'skipped');
    debt.status        = hasOverdue ? 'overdue' : 'pending';
    const remainder    = dueValue - payAmount;
    const interestRate = parseFloat(debt.interestRate) || 0;
    const carry        = parseFloat((remainder * (1 + interestRate / 100)).toFixed(2));
    const desc = isPartial
      ? `💰 Pagamento parcial: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} · Pago: R$ ${payAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · Saldo transferido (c/ juros): R$ ${carry.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      : `💰 Pagamento registrado: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} (R$ ${dueValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
    await Activity.create({ tenant, text: desc, type: 'success' });
  }

  await debt.save();
  return NextResponse.json(debt.toJSON());
}
