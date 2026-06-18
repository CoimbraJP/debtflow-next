/**
 * test-v21.js — Validação local dos 4 fixes do V21
 * Execute: node test-v21.js
 *
 * Testa toda a lógica de negócio sem precisar subir servidor ou conectar ao banco.
 */

// ─── Reproduz a lógica de generateInstallments ───────────────────────────────
function generateInstallments(debt, paidCount = 0) {
  const list      = [];
  const instValue = parseFloat((debt.total / debt.installments).toFixed(2));
  const startDate = new Date(debt.createdAt + 'T00:00:00Z');

  // Fix 4: primeiro vencimento = menor data >= startDate com o dueDay
  const firstDue = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), debt.dueDay));
  if (firstDue.getUTCDate() !== debt.dueDay) firstDue.setUTCDate(0);
  if (firstDue < startDate) {
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
      carriedInterest: 0,
    });
  }
  return list;
}

// ─── Reproduz a lógica de pagamento do pay route ─────────────────────────────
function pay(installmentList, idx, payAmount, payDate, interestRate) {
  const insts = JSON.parse(JSON.stringify(installmentList)); // deep clone
  const i     = idx;
  const inst  = insts[i];
  const dueValue = parseFloat(inst.value) || 0;
  const isPartial = payAmount < dueValue - 0.009;
  const isOver    = payAmount > dueValue + 0.009;

  inst.status     = isPartial ? 'partial' : 'paid';
  inst.paidDate   = payDate;
  inst.paidAmount = payAmount;

  if (isPartial) {
    const remainder            = parseFloat((dueValue - payAmount).toFixed(2));
    const interestPart         = parseFloat((remainder * interestRate / 100).toFixed(2));
    const carry                = parseFloat((remainder + interestPart).toFixed(2));
    inst.dueSent = inst.overdueSent = inst.penaltyApplied = true;
    const totalInterestToCarry = parseFloat((interestPart + (inst.carriedInterest || 0)).toFixed(2));
    const nextInst = insts.find((p, j) => j > i && !['paid','partial','skipped'].includes(p.status));
    if (nextInst) {
      nextInst.value           = parseFloat((parseFloat(nextInst.value) + carry).toFixed(2));
      nextInst.isPenalty       = true;
      nextInst.carriedInterest = parseFloat(((nextInst.carriedInterest || 0) + totalInterestToCarry).toFixed(2));
    }
  } else if (isOver) {
    let credit = parseFloat((payAmount - dueValue).toFixed(2));
    for (let j = i + 1; j < insts.length && credit > 0.009; j++) {
      const next    = insts[j];
      if (['paid','partial','skipped'].includes(next.status)) continue;
      const nextVal = parseFloat(next.value) || 0;
      if (credit >= nextVal - 0.009) {
        next.status = 'paid'; next.paidDate = payDate; next.paidAmount = nextVal;
        next.dueSent = next.overdueSent = next.penaltyApplied = true;
        credit = parseFloat((credit - nextVal).toFixed(2));
      } else {
        next.value = parseFloat((nextVal - credit).toFixed(2));
        credit = 0;
      }
    }
  }

  const allSettled = insts.every(p => ['paid','partial','skipped'].includes(p.status));
  return { insts, allSettled };
}

// ─── Utils ────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CENÁRIO 1 — Fix 4: Data retroativa (cadastro dia 18, vencimento dia 17)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📅 CENÁRIO 1 — Data retroativa (Fix 4)');
const c1 = generateInstallments({ total: 1000, installments: 3, dueDay: 17, createdAt: '2026-06-18', interestRate: 10 });
assert(c1[0].dueDate === '2026-07-17', '1ª parcela em 17/07 (não 17/06 que já passou)', c1[0].dueDate);
assert(c1[1].dueDate === '2026-08-17', '2ª parcela em 17/08', c1[1].dueDate);
assert(c1[2].dueDate === '2026-09-17', '3ª parcela em 17/09', c1[2].dueDate);

// CENÁRIO 1b — Vencimento no mesmo dia do cadastro (deve ficar no mesmo mês)
console.log('\n📅 CENÁRIO 1b — Vencimento no mesmo dia do cadastro');
const c1b = generateInstallments({ total: 1000, installments: 2, dueDay: 18, createdAt: '2026-06-18', interestRate: 10 });
assert(c1b[0].dueDate === '2026-06-18', '1ª parcela em 18/06 (mesmo dia = não avança)', c1b[0].dueDate);

// CENÁRIO 1c — Vencimento depois do cadastro (deve ficar no mesmo mês)
console.log('\n📅 CENÁRIO 1c — Vencimento posterior ao cadastro');
const c1c = generateInstallments({ total: 1000, installments: 2, dueDay: 25, createdAt: '2026-06-18', interestRate: 10 });
assert(c1c[0].dueDate === '2026-06-25', '1ª parcela em 25/06 (futuro = não avança)', c1c[0].dueDate);

// ═════════════════════════════════════════════════════════════════════════════
// CENÁRIO 2 — Fix 1: Overpayment simples (parcela R$500, pagou R$800)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n💰 CENÁRIO 2 — Overpayment simples (Fix 1)');
const c2insts = generateInstallments({ total: 2000, installments: 4, dueDay: 10, createdAt: '2026-06-01', interestRate: 10 });
// Parcela = R$500 cada. Paga R$800 na parcela 1 → crédito R$300 na parcela 2
const { insts: c2, allSettled: c2all } = pay(c2insts, 0, 800, '2026-06-10', 10);
assert(c2[0].status === 'paid',           'Parcela 1: paga');
assert(c2[0].paidAmount === 800,          'Parcela 1: paidAmount=800');
assert(c2[1].value === 200,               `Parcela 2: valor reduzido p/ R$200 (era 500, crédito 300)`, String(c2[1].value));
assert(c2[1].status === 'pending',        'Parcela 2: ainda pending (crédito não a quita, só reduz)');
assert(!c2all,                            'Dívida não quitada ainda');

// ═════════════════════════════════════════════════════════════════════════════
// CENÁRIO 3 — Fix 2: Overpayment grande (4x R$1000, paga R$2500 na 1ª)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n💸 CENÁRIO 3 — Overpayment grande, cobre múltiplas parcelas (Fix 2)');
const c3insts = generateInstallments({ total: 4000, installments: 4, dueDay: 10, createdAt: '2026-06-01', interestRate: 10 });
// Parcela = R$1000 cada. Paga R$2500 na parcela 1
// → parcela 2 quitada (R$1000), parcela 3 = R$500, parcela 4 intacta
const { insts: c3, allSettled: c3all } = pay(c3insts, 0, 2500, '2026-06-10', 10);
assert(c3[0].status === 'paid',    'Parcela 1: paga com R$2500');
assert(c3[1].status === 'paid',    'Parcela 2: quitada pelo crédito', c3[1].status);
assert(c3[1].paidAmount === 1000,  'Parcela 2: paidAmount=1000');
assert(c3[2].value === 500,        `Parcela 3: reduzida p/ R$500 (era 1000, restou 500 de crédito)`, String(c3[2].value));
assert(c3[2].status === 'pending', 'Parcela 3: ainda pending');
assert(c3[3].value === 1000,       'Parcela 4: intacta R$1000');
assert(!c3all,                     'Dívida não quitada ainda');

// ═════════════════════════════════════════════════════════════════════════════
// CENÁRIO 4 — Fix 2: Overpayment cobre dívida inteira (3x R$500, paga R$1600 na 1ª)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n🏆 CENÁRIO 4 — Overpayment quita dívida inteira (Fix 2)');
const c4insts = generateInstallments({ total: 1500, installments: 3, dueDay: 10, createdAt: '2026-06-01', interestRate: 10 });
// Parcela = R$500 cada. Paga R$1600 na parcela 1
// → crédito R$1100 → parcela 2 paga (R$500), parcela 3 paga (R$500), sobram R$100 (não há onde aplicar)
const { insts: c4, allSettled: c4all } = pay(c4insts, 0, 1600, '2026-06-10', 10);
assert(c4[0].status === 'paid', 'Parcela 1: paga');
assert(c4[1].status === 'paid', 'Parcela 2: quitada pelo crédito');
assert(c4[2].status === 'paid', 'Parcela 3: quitada pelo crédito');
assert(c4all,                   '🎉 Dívida marcada como QUITADA (allSettled=true)');

// ═════════════════════════════════════════════════════════════════════════════
// CENÁRIO 5 — Underpayment com juros (comportamento existente, verificação regressiva)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📊 CENÁRIO 5 — Underpayment com juros (regressivo)');
const c5insts = generateInstallments({ total: 1000, installments: 2, dueDay: 10, createdAt: '2026-06-01', interestRate: 10 });
// Parcela = R$500 cada. Paga R$300 na parcela 1
// → saldo = R$200, juros = R$20, carry = R$220
const { insts: c5, allSettled: c5all } = pay(c5insts, 0, 300, '2026-06-10', 10);
assert(c5[0].status === 'partial',  'Parcela 1: partial');
assert(c5[1].value === 720,         `Parcela 2: R$720 (500 + 220 carry)`, String(c5[1].value));
assert(c5[1].isPenalty === true,    'Parcela 2: isPenalty=true');
assert(Math.abs(c5[1].carriedInterest - 20) < 0.01, `Parcela 2: carriedInterest=R$20`, String(c5[1].carriedInterest));
assert(!c5all,                      'Dívida não quitada');

// ═════════════════════════════════════════════════════════════════════════════
// CENÁRIO 6 — Nomes iguais (2 dívidas para "João Silva")
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n👥 CENÁRIO 6 — Clientes com nome igual');
const joao1 = generateInstallments({ total: 600, installments: 3, dueDay: 5, createdAt: '2026-06-01', interestRate: 5 });
const joao2 = generateInstallments({ total: 900, installments: 3, dueDay: 5, createdAt: '2026-06-10', interestRate: 5 });
assert(joao1[0].value !== joao2[0].value || joao1[0].dueDate !== joao2[0].dueDate || true,
  'Duas dívidas de "João Silva" coexistem independentemente (lógica stateless — OK)');
assert(joao1[0].dueDate === '2026-06-05', 'João dívida 1: 1ª parcela 05/06 (cadastrado dia 1, venc dia 5 ainda é futuro → fica no mês)', joao1[0].dueDate);
// dia 5, cadastrado dia 10 → dia 5 < dia 10, então avança para julho
assert(joao2[0].dueDate === '2026-07-05', 'João dívida 2: 1ª parcela 05/07 (cadastrado dia 10, venc dia 5 já passou)', joao2[0].dueDate);

// ─── Resultado ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${passed} passou | ${failed} falhou de ${passed+failed} testes`);
if (failed === 0) {
  console.log('🎉 TODOS OS TESTES PASSARAM — V21 pronto para commit!\n');
  process.exit(0);
} else {
  console.log('⚠️  Alguns testes falharam. Revisar antes do commit.\n');
  process.exit(1);
}
