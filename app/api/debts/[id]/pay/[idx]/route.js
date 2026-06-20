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

  const inst         = debt.installmentList[i];
  const dueValue     = parseFloat(inst.value) || 0;
  const interestRate = parseFloat(debt.interestRate) || 0;
  const payAmount    = body.payAmount && body.payAmount > 0 ? parseFloat(body.payAmount) : dueValue;

  // ── Detectar pagamento de atraso ──────────────────────────────────────────
  // Se a data de pagamento é posterior ao vencimento, o excedente dentro do
  // intervalo [dueValue, dueValue*(1+rate/100)] é juros de atraso — NÃO crédito.
  const isLate       = payDate > inst.dueDate;
  const overdueValue = isLate
    ? parseFloat((dueValue * (1 + interestRate / 100)).toFixed(2))
    : dueValue;

  const isPartial   = payAmount < dueValue - 0.009;
  // Pagamento em atraso: entre o valor original e o valor c/ juros → quitação completa
  const isLatePmt   = isLate && !isPartial && payAmount > dueValue + 0.009 && payAmount <= overdueValue + 0.009;
  // Overpayment real: além do valor c/ juros (ou sem atraso mas acima do valor)
  const isOver      = !isPartial && !isLatePmt && payAmount > (isLate ? overdueValue : dueValue) + 0.009;

  inst.status            = isPartial ? 'partial' : 'paid';
  inst.paidDate          = payDate;
  inst.paidAmount        = payAmount;
  inst.creditPaid        = false;
  inst.lateInterestPaid  = isLatePmt ? parseFloat((payAmount - dueValue).toFixed(2)) : 0;

  if (isPartial) {
    // ── UNDERPAYMENT: saldo restante + juros transferido para a próxima parcela ──
    const remainder            = parseFloat((dueValue - payAmount).toFixed(2));
    const interestPart         = parseFloat((remainder * interestRate / 100).toFixed(2));
    const carry                = parseFloat((remainder + interestPart).toFixed(2));

    inst.dueSent               = true;
    inst.overdueSent           = true;
    inst.penaltyApplied        = true;

    const totalInterestToCarry = parseFloat((interestPart + (inst.carriedInterest || 0)).toFixed(2));

    const nextInst = debt.installmentList.find((p, j) => j > i && !['paid', 'partial', 'skipped'].includes(p.status));
    if (nextInst) {
      nextInst.value           = parseFloat((parseFloat(nextInst.value) + carry).toFixed(2));
      nextInst.isPenalty       = true;
      nextInst.carriedInterest = parseFloat(((nextInst.carriedInterest || 0) + totalInterestToCarry).toFixed(2));
    }

  } else if (isOver) {
    // ── OVERPAYMENT REAL: crédito propagado para parcelas seguintes SEM juros ──
    // Base de crédito: excedente acima do overdueValue (se em atraso) ou dueValue
    const creditBase = isLate ? overdueValue : dueValue;
    let credit = parseFloat((payAmount - creditBase).toFixed(2));

    for (let j = i + 1; j < debt.installmentList.length && credit > 0.009; j++) {
      const next = debt.installmentList[j];
      if (['paid', 'partial', 'skipped'].includes(next.status)) continue;

      const nextVal = parseFloat(next.value) || 0;

      if (credit >= nextVal - 0.009) {
        next.status         = 'paid';
        next.paidDate       = payDate;
        next.paidAmount     = nextVal;
        next.creditPaid     = true;
        next.dueSent        = true;
        next.overdueSent    = true;
        next.penaltyApplied = true;
        credit = parseFloat((credit - nextVal).toFixed(2));
      } else {
        next.value = parseFloat((nextVal - credit).toFixed(2));
        credit = 0;
      }
    }
  }
  // isLatePmt: nenhum carry — juros ficam em inst.lateInterestPaid

  // ── Dívida quitada se todas as parcelas estiverem em estado final ──
  const allSettled = debt.installmentList.every(p => ['paid', 'partial', 'skipped'].includes(p.status));
  if (allSettled) {
    debt.status = 'paid';
    await Activity.create({
      tenant,
      text: `✅ Dívida quitada: <strong>${debt.name}</strong> — ${debt.product}`,
      type: 'success',
    });
  } else {
    const hasOverdue = debt.installmentList.some(p => p.status === 'overdue' || p.status === 'skipped');
    debt.status      = hasOverdue ? 'overdue' : 'pending';

    let desc;
    if (isLatePmt) {
      desc = `💰 Pagamento em atraso: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} · Pago: R$ ${payAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (incl. R$ ${inst.lateInterestPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de juros)`;
    } else if (isOver) {
      const creditBase    = isLate ? overdueValue : dueValue;
      const creditOriginal = parseFloat((payAmount - creditBase).toFixed(2));
      desc = `💰 Pagamento antecipado: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} · Pago: R$ ${payAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · Crédito de R$ ${creditOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} aplicado nas próximas parcelas`;
    } else if (isPartial) {
      const remainder = parseFloat((dueValue - payAmount).toFixed(2));
      const carry     = parseFloat((remainder * (1 + interestRate / 100)).toFixed(2));
      desc = `💰 Pagamento parcial: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} · Pago: R$ ${payAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · Saldo transferido (c/ juros): R$ ${carry.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    } else {
      desc = `💰 Pagamento registrado: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} (R$ ${dueValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
    }
    await Activity.create({ tenant, text: desc, type: 'success' });
  }

  await debt.save();
  return NextResponse.json(debt.toJSON());
}
