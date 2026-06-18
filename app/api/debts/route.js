import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';
import { Activity }     from '@/lib/models/Activity';

function generateInstallments(debt, paidCount = 0) {
  const list      = [];
  const instValue = parseFloat((debt.total / debt.installments).toFixed(2));
  const startDate = new Date(debt.createdAt + 'T00:00:00Z');

  // Fix 4 — Smart date: compara numericamente dia do vencimento vs dia do cadastro.
  // Regra: se dueDay <= dia do cadastro → 1ª parcela no mês seguinte.
  //        se dueDay >  dia do cadastro → 1ª parcela no mês atual (ainda está no prazo).
  // Ex: cadastro dia 18, dueDay=17 ou 18 → julho; dueDay=19..28 → junho.
  const startDay = startDate.getUTCDate();
  const firstDue = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), debt.dueDay));
  if (firstDue.getUTCDate() !== debt.dueDay) firstDue.setUTCDate(0); // overflow (ex: 31 em fev)
  if (debt.dueDay <= startDay) {
    // Vencimento já passou (ou é hoje) — vai pro próximo mês
    firstDue.setUTCMonth(firstDue.getUTCMonth() + 1);
    firstDue.setUTCDate(debt.dueDay);
    if (firstDue.getUTCDate() !== debt.dueDay) firstDue.setUTCDate(0);
  }

  for (let i = 0; i < debt.installments; i++) {
    const dueDate = new Date(firstDue);
    dueDate.setUTCMonth(firstDue.getUTCMonth() + i);
    dueDate.setUTCDate(debt.dueDay);
    if (dueDate.getUTCDate() !== debt.dueDay) dueDate.setUTCDate(0);

    const dueDateStr  = dueDate.toISOString().slice(0, 10);
    const alreadyPaid = i < paidCount;

    list.push({
      number:         i + 1,
      value:          instValue,
      originalValue:  instValue,
      dueDate:        dueDateStr,
      status:         alreadyPaid ? 'paid' : 'pending',
      isPenalty:      false,
      penaltyRate:    0,
      penaltyApplied: alreadyPaid,
      dueSent:        alreadyPaid,
      overdueSent:    alreadyPaid,
      paidDate:       alreadyPaid ? dueDateStr : null,
    });
  }
  return list;
}

// GET /api/debts — Listar por tenant
export async function GET(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const debts  = await Debt.find({ tenant }).sort({ createdAt: -1 });
  return NextResponse.json(debts.map(d => d.toJSON()));
}

// POST /api/debts — Criar nova dívida
export async function POST(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const body   = await request.json();

  const {
    name, phone, address, product, total, installments,
    dueDay, interestRate, notes, startDate, paidInstallments,
  } = body;

  if (!name || !product || !total || !installments || !dueDay || !startDate) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 });
  }
  if (!phone || !String(phone).trim()) {
    return NextResponse.json({ error: 'Numero de WhatsApp e obrigatorio' }, { status: 400 });
  }
  if (dueDay < 1 || dueDay > 28) {
    return NextResponse.json({ error: 'Dia de vencimento deve ser entre 1 e 28' }, { status: 400 });
  }

  const paidCount = Math.min(parseInt(paidInstallments) || 0, parseInt(installments));
  const totalInst = parseInt(installments);
  const debtData  = {
    tenant,
    name, phone: phone || '', address: address || '', product,
    total:        parseFloat(total),
    installments: totalInst,
    dueDay:       parseInt(dueDay),
    interestRate: parseFloat(interestRate) || 10,
    notes:        notes || '',
    status:       paidCount >= totalInst ? 'paid' : 'pending',
    createdAt:    startDate,
    installmentList: [],
  };

  debtData.installmentList = generateInstallments(debtData, paidCount);

  const debt = await Debt.create(debtData);

  const paidLabel = paidCount > 0 ? ` (${paidCount} parcelas ja pagas)` : '';
  await Activity.create({
    tenant,
    text: `Nova divida: <strong>${name}</strong> - ${product} (R$ ${Number(total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})${paidLabel}`,
    type: 'info',
  });

  return NextResponse.json(debt.toJSON(), { status: 201 });
}
