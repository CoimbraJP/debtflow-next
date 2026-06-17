import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';
import { Activity }     from '@/lib/models/Activity';

// POST /api/debts/:id/skip/:idx — Registrar não pagamento (Não Pagou)
// Parcela permanece sem pagamento; valor + juros é transferido para a próxima parcela.
export async function POST(request, { params }) {
  await connectDB();
  const tenant      = request.headers.get('x-tenant') || 'default';
  const { id, idx } = await params;

  const debt = await Debt.findOne({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Dívida não encontrada' }, { status: 404 });

  const i = parseInt(idx);
  if (i < 0 || i >= debt.installmentList.length) {
    return NextResponse.json({ error: 'Parcela não encontrada' }, { status: 404 });
  }

  const inst         = debt.installmentList[i];
  const instValue    = parseFloat(inst.value) || 0;
  const interestRate = parseFloat(debt.interestRate) || 0;
  const interest     = parseFloat((instValue * interestRate / 100).toFixed(2));
  const carry        = parseFloat((instValue + interest).toFixed(2));

  // Juros acumulados desta parcela + juros de carries anteriores (cadeia de skips/parciais)
  // Garante que o carriedInterest do próximo sempre reflete o TOTAL de juros acumulados
  const totalInterestToCarry = parseFloat((interest + (inst.carriedInterest || 0)).toFixed(2));

  // Marca parcela como 'skipped' — sem pagamento, saldo levado para a próxima
  inst.status         = 'skipped';
  inst.penaltyApplied = true;
  inst.dueSent        = true;
  inst.overdueSent    = true;

  // Transfere valor + juros para a próxima parcela em aberto
  const nextInst = debt.installmentList.find((p, j) => j > i && !['paid', 'partial', 'skipped'].includes(p.status));
  if (nextInst) {
    nextInst.value           = parseFloat((parseFloat(nextInst.value) + carry).toFixed(2));
    nextInst.isPenalty       = true;
    nextInst.carriedInterest = parseFloat(((nextInst.carriedInterest || 0) + totalInterestToCarry).toFixed(2));
  }

  // Registra histórico
  await Activity.create({
    tenant,
    text: `❌ Não pagou: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} · R$ ${instValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} + juros R$ ${interest.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} = R$ ${carry.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} transferidos`,
    type: 'danger',
  });

  // Recalcula status da dívida
  const allSettled = debt.installmentList.every(p => ['paid', 'partial', 'skipped'].includes(p.status));
  const hasOverdue  = debt.installmentList.some(p => p.status === 'skipped' || p.status === 'overdue');
  debt.status = allSettled ? 'paid' : hasOverdue ? 'overdue' : 'pending';

  await debt.save();
  return NextResponse.json(debt.toJSON());
}
