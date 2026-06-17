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

  // Status correto: 'partial' se pagamento menor que o valor devido
  inst.status     = isPartial ? 'partial' : 'paid';
  inst.paidDate   = payDate;
  inst.paidAmount = payAmount;

  // Se pagamento parcial, adiciona saldo restante + juros à próxima parcela
  // Fórmula: saldo = (valorDevido - valorPago); carry = saldo * (1 + taxa/100)
  // Ex: R$100 - R$40 = R$60 saldo; 10% de juros sobre R$60 = R$6; total carry = R$66
  // O juro é calculado SOMENTE sobre o saldo restante, não sobre o valor cheio.
  if (isPartial) {
    const remainder    = dueValue - payAmount;
    const interestRate = parseFloat(debt.interestRate) || 0;
    const carry        = parseFloat((remainder * (1 + interestRate / 100)).toFixed(2));

    // Previne re-processamento pelo scheduler
    inst.dueSent      = true;
    inst.overdueSent  = true;
    inst.penaltyApplied = true;

    // Encontra a próxima parcela ainda em aberto
    const nextInst = debt.installmentList.find((p, j) => j > i && !['paid', 'partial', 'skipped'].includes(p.status));
    if (nextInst) {
      nextInst.value     = parseFloat(nextInst.value) + carry;
      nextInst.isPenalty = true;
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
    const hasOverdu