/**
 * Teste de integração: 5 clientes, todos os cenários
 * Verifica que KPI Recebidos do Mês bate com Juros Já Pagos do cliente
 *
 * Regra de consistência:
 *   sum(KPI de todas parcelas pagas) + pendingInterest = jurosJaPagos
 *   onde pendingInterest = juros acumulados em parcelas ainda skipped/partial
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calcSkip, calcPay, calcJurosJaPagos, calcKpiJurosMensais } from '../lib/financialLogic.mjs';

// ─── helpers ────────────────────────────────────────────────────────────────

function inst(overrides) {
  return {
    value: 500, originalValue: 500, status: 'pending',
    isPenalty: false, penaltyRate: 0, penaltyApplied: false,
    paidDate: null, paidAmount: null, carriedInterest: 0,
    ...overrides,
  };
}

function payFull(i) {
  return { ...i, status: 'paid', paidDate: '2026-06-17', paidAmount: i.value };
}

function applySkip(list, idx, rate) {
  const i = list[idx];
  const r = calcSkip(i.value, rate, i.carriedInterest || 0);
  list[idx] = { ...i, status: 'skipped', isPenalty: true, penaltyApplied: true };
  if (list[idx + 1]) {
    const next = list[idx + 1];
    list[idx + 1] = {
      ...next,
      value: parseFloat((next.value + r.carry).toFixed(2)),
      isPenalty: true,
      carriedInterest: parseFloat(((next.carriedInterest || 0) + r.totalInterestToCarry).toFixed(2)),
    };
  }
  return r;
}

function applyPartial(list, idx, paid, rate) {
  const i = list[idx];
  const r = calcPay(i.value, paid, rate, i.carriedInterest || 0);
  list[idx] = { ...i, status: 'partial', paidDate: '2026-06-17', paidAmount: paid };
  if (r.isPartial && list[idx + 1]) {
    const next = list[idx + 1];
    list[idx + 1] = {
      ...next,
      value: parseFloat((next.value + r.carry).toFixed(2)),
      isPenalty: true,
      carriedInterest: parseFloat(((next.carriedInterest || 0) + r.totalInterestToCarry).toFixed(2)),
    };
  }
  return r;
}

// Soma KPI de todas as parcelas da lista (somente paid/partial)
function sumKpi(list, rate) {
  let total = 0;
  list.forEach((_, i) => {
    if (list[i].status === 'paid' || list[i].status === 'partial') {
      total = parseFloat((total + calcKpiJurosMensais(list, i, rate)).toFixed(2));
    }
  });
  return total;
}

// Juros pendentes: somente de cadeias skip/partial NAO resolvidas
// Uma cadeia e "resolvida" se termina num paid+isPenalty
function pendingInterest(list, rate) {
  let total = 0;
  let i = 0;
  while (i < list.length) {
    if (list[i].status !== 'skipped' && list[i].status !== 'partial') { i++; continue; }
    // Avança ate o fim da cadeia consecutiva de skip/partial
    let j = i;
    while (j + 1 < list.length &&
           (list[j+1].status === 'skipped' || list[j+1].status === 'partial')) {
      j++;
    }
    // Cadeia vai de i..j; ja foi resolvida se j+1 e paid+isPenalty
    const resolved = j + 1 < list.length &&
                     list[j+1].status === 'paid' &&
                     list[j+1].isPenalty === true;
    if (!resolved) {
      for (let k = i; k <= j; k++) {
        if (list[k].status === 'skipped') {
          total = parseFloat((total + list[k].value * rate / 100).toFixed(2));
        } else {
          const saldo = Math.max(0, list[k].value - (list[k].paidAmount || 0));
          total = parseFloat((total + saldo * rate / 100).toFixed(2));
        }
      }
    }
    i = j + 1;
  }
  return total;
}

// Verificação central: KPI + pendente = jurosJaPagos
function assertConsistency(list, rate, label) {
  const jjp  = calcJurosJaPagos(list, rate);
  const kpi  = sumKpi(list, rate);
  const pend = pendingInterest(list, rate);
  const check = parseFloat((kpi + pend).toFixed(2));
  assert.equal(check, jjp,
    `[${label}] KPI(${kpi}) + pending(${pend}) = ${check} ≠ jurosJaPagos(${jjp})`);
  return { jjp, kpi, pend };
}

// ─── Cliente 1: todos pagamentos integrais ───────────────────────────────────

describe('Cliente 1: Tudo pago integral (sem juros)', () => {
  const RATE = 10;
  const list = [
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
  ].map(payFull);

  test('jurosJaPagos = 0', () => assert.equal(calcJurosJaPagos(list, RATE), 0));
  test('KPI total = 0',     () => assert.equal(sumKpi(list, RATE), 0));
  test('consistencia',      () => assertConsistency(list, RATE, 'C1'));
});

// ─── Cliente 2: Parcial P1 → Integral P2 ────────────────────────────────────
// P1: 1000, pagou 400 (saldo=600, juros=60, carry=660)
// P2: 1000+660=1660, pago integral
// P3: 1000, pago integral

describe('Cliente 2: Parcial P1 depois integral P2', () => {
  const RATE = 10;
  const list = [
    inst({ value:1000, originalValue:1000 }),
    inst({ value:1000, originalValue:1000 }),
    inst({ value:1000, originalValue:1000 }),
  ];

  applyPartial(list, 0, 400, RATE);       // P1 partial
  list[1] = payFull(list[1]);             // P2 integral (inclui carry)
  list[2] = payFull(list[2]);             // P3 integral

  test('P1 carriedInterest transferido para P2', () => {
    assert.equal(list[1].carriedInterest, 60);
    assert.equal(list[1].value, 1660);
  });

  test('KPI P1 (partial) = 0', () => {
    assert.equal(calcKpiJurosMensais(list, 0, RATE), 0);
  });

  test('KPI P2 (paid, backward scan encontra partial) = 60', () => {
    assert.equal(calcKpiJurosMensais(list, 1, RATE), 60);
  });

  test('KPI P3 (integral puro) = 0', () => {
    assert.equal(calcKpiJurosMensais(list, 2, RATE), 0);
  });

  test('KPI total = 60', () => assert.equal(sumKpi(list, RATE), 60));
  test('jurosJaPagos = 60', () => assert.equal(calcJurosJaPagos(list, RATE), 60));
  test('consistencia', () => assertConsistency(list, RATE, 'C2'));
});

// ─── Cliente 3: Skip P1 → Integral P2 ───────────────────────────────────────
// P1: 500, skip (juros=50, carry=550)
// P2: 500+550=1050, pago integral
// P3: 500, pago integral

describe('Cliente 3: Skip P1 depois integral P2', () => {
  const RATE = 10;
  const list = [
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
  ];

  applySkip(list, 0, RATE);    // P1 skip
  list[1] = payFull(list[1]);  // P2 integral
  list[2] = payFull(list[2]);  // P3 integral

  test('P2 absorveu carry corretamente', () => {
    assert.equal(list[1].value, 1050);
    assert.equal(list[1].carriedInterest, 50);
  });

  test('KPI P2 backward scan = 50', () => {
    assert.equal(calcKpiJurosMensais(list, 1, RATE), 50);
  });

  test('KPI total = 50', () => assert.equal(sumKpi(list, RATE), 50));
  test('jurosJaPagos = 50', () => assert.equal(calcJurosJaPagos(list, RATE), 50));
  test('consistencia', () => assertConsistency(list, RATE, 'C3'));
});

// ─── Cliente 4: Cadeia P1→P2→P3 skip → P4 pago ──────────────────────────────
// P1: 500 skip → juros=50, totalToCarry=50
// P2: 1050, ci=50 → skip → juros=105, totalToCarry=155
// P3: 1655, ci=155 → skip → juros=165.50, totalToCarry=320.50
// P4: 2320.50, ci=320.50 → pago integral
// P5: 500 → pago integral

describe('Cliente 4: Cadeia 3 skips → paid', () => {
  const RATE = 10;
  const list = [
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
    inst({ value:500, originalValue:500 }),
  ];

  applySkip(list, 0, RATE);   // P1 skip
  applySkip(list, 1, RATE);   // P2 skip
  applySkip(list, 2, RATE);   // P3 skip
  list[3] = payFull(list[3]); // P4 pago
  list[4] = payFull(list[4]); // P5 pago

  test('valores acumulados P2=1050, P3=1655, P4=2320.50', () => {
    assert.equal(list[1].value, 1050);
    assert.equal(list[2].value, 1655);
    assert.equal(list[3].value, 2320.50);
  });

  test('carriedInterest P2=50, P3=155, P4=320.50', () => {
    assert.equal(list[1].carriedInterest, 50);
    assert.equal(list[2].carriedInterest, 155);
    assert.equal(list[3].carriedInterest, 320.50);
  });

  test('KPI P4 backward scan = 320.50 (nao 165.50)', () => {
    assert.equal(calcKpiJurosMensais(list, 3, RATE), 320.50);
  });

  test('KPI P5 = 0', () => {
    assert.equal(calcKpiJurosMensais(list, 4, RATE), 0);
  });

  test('KPI total = 320.50', () => assert.equal(sumKpi(list, RATE), 320.50));
  test('jurosJaPagos = 320.50', () => assert.equal(calcJurosJaPagos(list, RATE), 320.50));
  test('consistencia', () => assertConsistency(list, RATE, 'C4'));
});

// ─── Cliente 5: Misto parcial + skip + paid ───────────────────────────────────
// P1: 800, parcial 300 (saldo=500, juros=60, carry=560, totalToCarry=60)
// P2: 800+560=1360, ci=60 → skip (juros=163.20, totalToCarry=223.20)
// P3: 800+1523.20=2323.20, ci=223.20 → pago integral
// P4: 800 → pago integral

describe('Cliente 5: Misto parcial + skip + paid', () => {
  const RATE = 12;
  const list = [
    inst({ value:800, originalValue:800 }),
    inst({ value:800, originalValue:800 }),
    inst({ value:800, originalValue:800 }),
    inst({ value:800, originalValue:800 }),
  ];

  applyPartial(list, 0, 300, RATE);  // P1 parcial
  applySkip(list, 1, RATE);          // P2 skip
  list[2] = payFull(list[2]);        // P3 pago integral
  list[3] = payFull(list[3]);        // P4 pago integral

  test('P1: paidAmount=300, saldo=500', () => {
    assert.equal(list[0].paidAmount, 300);
    assert.equal(list[0].value, 800);
  });

  test('P2 recebeu carry de P1 corretamente', () => {
    assert.equal(list[1].carriedInterest, 60);
    assert.equal(list[1].value, parseFloat((800 + 560).toFixed(2)));
  });

  test('P2 skip: juros=163.20, totalToCarry=223.20', () => {
    const r = calcSkip(list[1].value, RATE, list[1].carriedInterest);
    assert.equal(r.interest, 163.20);
    assert.equal(r.totalInterestToCarry, 223.20);
  });

  test('P3 recebeu carry de P2', () => {
    assert.equal(list[2].carriedInterest, 223.20);
  });

  test('KPI P1 (partial) = 0', () => {
    assert.equal(calcKpiJurosMensais(list, 0, RATE), 0);
  });

  test('KPI P3 backward scan: skip(163.20) + partial(60) = 223.20', () => {
    assert.equal(calcKpiJurosMensais(list, 2, RATE), 223.20);
  });

  test('KPI P4 = 0', () => {
    assert.equal(calcKpiJurosMensais(list, 3, RATE), 0);
  });

  test('KPI total = 223.20', () => assert.equal(sumKpi(list, RATE), 223.20));
  test('jurosJaPagos = 223.20', () => assert.equal(calcJurosJaPagos(list, RATE), 223.20));
  test('consistencia', () => assertConsistency(list, RATE, 'C5'));
});

// ─── Caso extra: juros pendentes (parcial sem resolução ainda) ───────────────

describe('Extra: Parcial nao resolvido — juros pendentes nao aparecem no KPI', () => {
  const RATE = 10;
  const list = [
    inst({ value:1000, originalValue:1000 }),
    inst({ value:1000, originalValue:1000 }),
  ];

  applyPartial(list, 0, 500, RATE); // P1 parcial, P2 ainda pending

  test('KPI P1 = 0 (juros ainda nao pagos)', () => {
    assert.equal(calcKpiJurosMensais(list, 0, RATE), 0);
  });

  test('jurosJaPagos = 50 (pendente)', () => {
    assert.equal(calcJurosJaPagos(list, RATE), 50);
  });

  test('pendingInterest = 50', () => {
    assert.equal(pendingInterest(list, RATE), 50);
  });

  test('KPI(0) + pending(50) = jurosJaPagos(50)', () => {
    assertConsistency(list, RATE, 'extra-partial-pending');
  });
});
