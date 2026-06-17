/**
 * DebtFlow — Scheduler (Server-Side)
 * Executado via Vercel Cron Job em /api/cron/scheduler (toda hora)
 * Também pode ser chamado manualmente via POST /api/cron/scheduler
 */

import { connectDB } from './mongodb.js';
import { Debt }      from './models/Debt.js';
import { Activity }  from './models/Activity.js';
import { Settings }  from './models/Settings.js';

const LATE_THRESHOLD_DAYS = 5;

// ── Utilidades de data ────────────────────────────────────────────────────
function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

/** positivo = due no futuro | 0 = hoje | negativo = em atraso */
function diffDays(todayStr, dueDateStr) {
  const t = new Date(todayStr   + 'T00:00:00Z');
  const d = new Date(dueDateStr + 'T00:00:00Z');
  return Math.round((d - t) / 86400000);
}

function getNextMonthDue(dueDateStr) {
  const d = new Date(dueDateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  return toDateOnly(d);
}

function formatCurrency(val) {
  return Number(val || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ── Envio WhatsApp via Evolution API ─────────────────────────────────────
async function sendWhatsApp(phone, text, settings) {
  if (!settings.apiUrl || !settings.instance || !settings.apiKey) return false;
  const cleanPhone = String(phone).replace(/\D/g, '');
  const url = `${settings.apiUrl.replace(/\/$/, '')}/message/sendText/${settings.instance}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': settings.apiKey },
      body: JSON.stringify({ number: cleanPhone, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function buildDueMsg(debt, inst, settings) {
  const tpl = settings.msgTemplate || '';
  return tpl
    .replace(/{nome}/g,           debt.name)
    .replace(/{produto}/g,        debt.product)
    .replace(/{valor}/g,          formatCurrency(inst.value))
    .replace(/{vencimento}/g,     formatDate(inst.dueDate))
    .replace(/{parcela}/g,        inst.number)
    .replace(/{total_parcelas}/g, debt.installments);
}

function buildOverdueMsg(debt, inst, daysOverdue, settings) {
  const tpl = settings.msgOverdue || '';
  const wi  = inst.value * (1 + (debt.interestRate || 2) / 100);
  return tpl
    .replace(/{nome}/g,            debt.name)
    .replace(/{produto}/g,         debt.product)
    .replace(/{valor}/g,           formatCurrency(inst.value))
    .replace(/{valor_com_juros}/g, formatCurrency(wi))
    .replace(/{vencimento}/g,      formatDate(inst.dueDate))
    .replace(/{parcela}/g,         inst.number)
    .replace(/{total_parcelas}/g,  debt.installments)
    .replace(/{dias_atraso}/g,     daysOverdue);
}

// ── Log de atividade ──────────────────────────────────────────────────────
async function log(text, type = 'info') {
  await Activity.create({ text, type });
  // Manter apenas últimas 200
  const count = await Activity.countDocuments();
  if (count > 200) {
    const oldest = await Activity.find().sort({ createdAt: 1 }).limit(count - 200).select('_id');
    await Activity.deleteMany({ _id: { $in: oldest.map(o => o._id) } });
  }
}

// ── Motor principal ───────────────────────────────────────────────────────
export async function runScheduler() {
  await connectDB();

  const today    = toDateOnly(new Date());
  const settings = (await Settings.findOne({ key: 'global' }))?.toJSON() || {};
  const debts    = await Debt.find({ status: { $ne: 'paid' } });

  let processed = 0;

  for (const debt of debts) {
    let changed = false;

    for (const inst of debt.installmentList) {
      // Ignora parcelas já processadas (pagas, parciais ou com "não pagou")
      if (['paid', 'partial', 'skipped'].includes(inst.status)) continue;

      const diff       = diffDays(today, inst.dueDate);
      const daysOverdue = -diff; // positivo = dias em atraso

      // ── Dia do vencimento: enviar cobrança ─────────────────────
      if (diff === 0 && !inst.dueSent) {
        inst.dueSent = true;
        changed = true;
        if (debt.phone) {
          const msg = buildDueMsg(debt, inst, settings);
          await sendWhatsApp(debt.phone, msg, settings);
        }
        await log(`🔔 Cobrança gerada: <strong>${debt.name}</strong> — Parcela ${inst.number}/${debt.installments} (R$ ${formatCurrency(inst.value)})`, 'info');
      }

      // ── 1–4 dias em atraso: aviso leve ────────────────────────
      if (daysOverdue > 0 && daysOverdue < LATE_THRESHOLD_DAYS && !inst.overdueSent) {
        inst.overdueSent = true;
        changed = true;
        await log(`⏰ Aviso: <strong>${debt.name}</strong> está ${daysOverdue} dia(s) em atraso — Parcela ${inst.number}/${debt.installments}`, 'warning');
      }

      // ── 5+ dias em atraso: aplicar juros (UMA VEZ) ────────────
      if (daysOverdue >= LATE_THRESHOLD_DAYS && !inst.penaltyApplied) {
        const interest = (debt.interestRate || 2) / 100;
        const newVal   = parseFloat((inst.value * (1 + interest)).toFixed(2));
        const oldVal   = inst.value;
        const nextDate = getNextMonthDue(inst.dueDate);

        inst.value          = newVal;
        inst.dueDate        = nextDate;
        inst.isPenalty      = true;
        inst.penaltyRate    = debt.interestRate || 2;
        inst.penaltyApplied = true;
        inst.dueSent        = false;
        inst.overdueSent    = false;
        inst.status         = 'pending';
        changed = true;

        if (debt.phone) {
          const msg = buildOverdueMsg(debt, inst, daysOverdue, settings);
          await sendWhatsApp(debt.phone, msg, settings);
        }
        await log(`⚠️ Juros aplicados: <strong>${debt.name}</strong> — Parcela ${inst.number} → ${formatDate(nextDate)} (R$ ${formatCurrency(oldVal)} → R$ ${formatCurrency(newVal)})`, 'warning');
      }
    }

    // ── Atualizar status global da dívida ──────────────────────────
    const allSettled = debt.installmentList.every(i => ['paid', 'partial', 'skipped'].includes(i.status));
    const hasOverdue = debt.installmentList.some(i =>
      i.status === 'overdue' || i.status === 'skipped' ||
      (!['paid', 'partial', 'skipped'].includes(i.status) && diffDays(today, i.dueDate) < 0)
    );

    const newStatus = allSettled ? 'paid' : hasOverdue ? 'overdue' : 'pending';
    if (debt.status !== newStatus) { debt.status = newStatus; changed = true; }

    if (allSettled && debt.status === 'paid') 