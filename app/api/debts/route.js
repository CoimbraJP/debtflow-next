import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';
import { Activity }     from '@/lib/models/Activity';

function generateInstallments(debt, paidCount = 0) {
  const list       = [];
  const hasEntrada = (debt.entrada || 0) > 0.009;
  const entradaVal = hasEntrada ? parseFloat(parseFloat(debt.entrada).toFixed(2)) : 0;
  const remaining  = parseFloat((debt.total - entradaVal).toFixed(2));
  const instValue  = parseFloat((remaining / debt.installments).toFixed(2));
  const startDate  = new Date(debt.createdAt + 'T00:00:00Z');
  const startDay   = startDate.getUTCDate();
  const createdStr = startDate.toISOString().slice(0, 10);

  // ── Parcela de ENTRADA (sempre paga, número 1) ───────────────────────
  if (hasEntrada) {
    list.push({
      number:         1,
      value:          entradaVal,
      originalValue:  entradaVal,
      dueDate:        createdStr,
      status:         'paid',
      isEntrada:      true,
      isPenalty:      false,
      penaltyRate:    0,
      penaltyApplied: true,
      dueSent:        true,
      overdueSent:    true,
      paidDate:       createdStr,
      paidAmount:     entradaVal,
      carriedInterest:0,
      creditPaid:     false,
      lateInterestPaid:0,
      manualInterest: 0,
    });
  }

  // ── Datas regulares ──────────────────────────────────────────────────
  const offset   = hasEntrada ? 1 : 0; // offset de número para parcelas regulares
  const firstDue = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), debt.dueDay));
  if (firstDue.getUTCDate() !== debt.dueDay) firstDue.setUTCDate(0);
  if (debt.dueDay <= startDay) {
    firstDue.setUTCMonth(firstDue.getUTCMonth() + 1);
    firstDue.setUTCDate(debt.dueDay);
    if (firstDue.getUTCDate() !== debt.dueDay) firstDue.setUTCDate(0);
  }
  if (paidCount > 0) {
    firstDue.setUTCMonth(firstDue.getUTCMonth() - paidCount);
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
      number:         i + 1 + offset,
      value:          instValue,
      originalValue:  instValue,
      dueDate:        dueDateStr,
      status:         alreadyPaid ? 'paid' : 'pending',
      isEntrada:      false,
      isPenalty:      false,
      penaltyRate:    0,
      penaltyApplied: alreadyPaid,
      dueSent:        alreadyPaid,
      overdueSent:    alreadyPaid,
      paidDate:       alreadyPaid ? dueDateStr : null,
      paidAmount:     alreadyPaid ? instValue : null,
      carriedInterest:0,
      creditPaid:     false,
      lateInterestPaid:0,
      manualInterest: 0,
    });
  }
  return list;
}

export async function GET(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const debts  = await Debt.find({ tenant }).sort({ createdAt: -1 });
  return NextResponse.json(debts.map(d => d.toJSON()));
}

export async function POST(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const body   = await request.json();

  const {
    name, phone, address, product, total, installments,
    dueDay, interestRate, notes, startDate, paidInstallments, entrada,
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

  const entradaVal = parseFloat(entrada) || 0;
  const totalVal   = parseFloat(total);
  if (entradaVal >= totalVal && entradaVal > 0) {
    return NextResponse.json({ error: 'Entrada deve ser menor que o valor total' }, { status: 400 });
  }

  const totalInst  = parseInt(installments);
  const paidCount  = Math.min(parseInt(paidInstallments) || 0, totalInst);
  const debtData   = {
    tenant,
    name, phone: phone || '', address: address || '', product,
    total:        totalVal,
    installments: totalInst,
    dueDay:       parseInt(dueDay),
    interestRate: parseFloat(interestRate) || 10,
    notes:        notes || '',
    entrada:      entradaVal,
    status:       paidCount >= totalInst ? 'paid' : 'pending',
    createdAt:    startDate,
    installmentList: [],
  };

  debtData.installmentList = generateInstallments(debtData, paidCount);

  const debt = await Debt.create(debtData);

  const entradaLabel = entradaVal > 0 ? ` (entrada R$ ${entradaVal.toLocaleString('pt-BR',{minimumFractionDigits:2})})` : '';
  const paidLabel    = paidCount > 0 ? ` · ${paidCount} parcelas pré-pagas` : '';
  await Activity.create({
    tenant,
    text: `Nova divida: <strong>${name}</strong> - ${product} (R$ ${totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})${entradaLabel}${paidLabel}`,
    type: 'info',
  });

  return NextResponse.json(debt.toJSON(), { status: 201 });
}
