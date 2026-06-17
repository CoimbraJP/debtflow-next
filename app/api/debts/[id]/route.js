import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Debt }         from '@/lib/models/Debt';
import { Activity }     from '@/lib/models/Activity';

function generateInstallments(debt) {
  const list      = [];
  const instValue = parseFloat((debt.total / debt.installments).toFixed(2));
  const startDate = new Date(debt.createdAt + 'T00:00:00Z');

  for (let i = 0; i < debt.installments; i++) {
    const dueDate = new Date(startDate);
    dueDate.setUTCMonth(startDate.getUTCMonth() + i);
    dueDate.setUTCDate(debt.dueDay);
    if (dueDate.getUTCDate() !== debt.dueDay) dueDate.setUTCDate(0);

    list.push({
      number: i + 1, value: instValue, originalValue: instValue,
      dueDate: dueDate.toISOString().slice(0, 10),
      status: 'pending', isPenalty: false, penaltyRate: 0,
      penaltyApplied: false, dueSent: false, overdueSent: false, paidDate: null,
    });
  }
  return list;
}

// PUT /api/debts/:id — Atualizar dívida
export async function PUT(request, { params }) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const { id } = await params;
  const body   = await request.json();

  const debt = await Debt.findOne({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Dívida não encontrada' }, { status: 404 });

  const { name, phone, address, product, total, installments, dueDay, interestRate, notes, startDate } = body;

  // Normaliza createdAt para YYYY-MM-DD antes de comparar
  // (Mongoose devolve Date object; comparação estrita com string sempre falhava)
  const dbCreatedAt = String(debt.createdAt || '').slice(0, 10);
  const needsRegen = (
    debt.total        !== parseFloat(total)        ||
    debt.installments !== parseInt(installments)   ||
    debt.dueDay       !== parseInt(dueDay)         ||
    dbCreatedAt       !== (startDate || '').slice(0, 10)
  );

  // Preserva pagamentos antes de regenerar
  const paidByNum = {};
  if (needsRegen) {
    debt.installmentList.forEach(inst => {
      if (['paid', 'partial', 'skipped'].includes(inst.status)) {
        paidByNum[inst.number] = { status: inst.status, paidDate: inst.paidDate, paidAmount: inst.paidAmount };
      }
    });
  }

  debt.name         = name;
  debt.phone        = phone || '';
  debt.address      = address || '';
  debt.product      = product;
  debt.notes        = notes || '';
  debt.total        = parseFloat(total);
  debt.installments = parseInt(installments);
  debt.dueDay       = parseInt(dueDay);
  debt.interestRate = parseFloat(interestRate) || 10;
  debt.createdAt    = startDate;

  if (needsRegen) {
    // Garante que createdAt é passado como string YYYY-MM-DD para generateInstallments
    const createdAtStr = String(debt.createdAt || startDate || '').slice(0, 10);
    const newList = generateInstallments({
      total: debt.total, installments: debt.installments,
      dueDay: debt.dueDay, createdAt: createdAtStr,
    });
    // Restaura pagamentos confirmados
    newList.forEach(inst => {
      if (paidByNum[inst.number]) {
        const p = paidByNum[inst.number];
        inst.status      = p.status;
        inst.paidDate    = p.paidDate;
        inst.paidAmount  = p.paidAmount || null;
        inst.penaltyApplied = true;
        inst.dueSent     = true;
        inst.overdueSent = true;
      }
    });
    debt.installmentList = newList;

    await Activity.create({
      tenant,
      text: `🔄 Parcelas regeneradas para <strong>${name}</strong> (${installments}x)`,
      type: 'warning',
    });
  }

  // Recalcula status geral
  const allSettled = debt.installmentList.every(i => ['paid', 'partial', 'skipped'].includes(i.status));
  const hasOverdue  = debt.installmentList.some(i => i.status === 'overdue' || i.status === 'skipped');
  debt.status = allSettled ? 'paid' : hasOverdue ? 'overdue' : 'pending';

  await debt.save();
  await Activity.create({
    tenant,
    text: `✏️ Dívida atualizada: <strong>${name}</strong> — ${product}`,
    type: 'info',
  });

  return NextResponse.json(debt.toJSON());
}

// DELETE /api/debts/:id — Remover dívida
export async function DELETE(request, { params }) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const { id } = await params;

  const debt = await Debt.findOneAndDelete({ _id: id, tenant });
  if (!debt) return NextResponse.json({ error: 'Dívida não encontrada' }, { status: 404 });

  await Activity.create({
    tenant,
    text: `🗑️ Dívida removida: <strong>${debt.name}</strong>`,
    type: 'warning',
  });

  return NextResponse.json({ ok: true });
}
