/**
 * DebtFlow — Testes Financeiros
 * Executa com: npm test  (ou: node --test tests/financial.test.mjs)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcSkip,
  calcPay,
  calcJurosJaPagos,
  calcKpiJurosMensais,
} from '../lib/financialLogic.mjs';

function mkInst(overrides = {}) {
  return {
    number: 1, value: 500, originalValue: 500, dueDate: '2026-06-15',
    status: 'pending', isPenalty: false, penaltyRate: 0, penaltyApplied: false,
    paidDate: null, paidAmount: null, carriedInterest: 0,
    ...overrides,
  };
}

// ─── 1. Pagamento Integral ───────────────────────────────────────────────────

describe('1. Pagamento Integral', () => {
  test('isPartial=false, carry=0', () => {
    const r = calcPay(1000, 1000, 10);
    assert.equal(r.isPartial, false);
    assert.equal(r.carry, 0);
  });

  test('payAmount=null trata como integral', () => {
    assert.equal(calcPay(1000, null, 10).isPartial, false);
  });

  test('tolerancia 1 centavo: 999.999 nao e parcial em parcela de 1000', () => {
    assert.equal(calcPay(1000, 999.999, 10).isPartial, false);
  });

  test('KPI juros mensais = 0', () => {
    const list = [mkInst({ status: 'paid', paidAmount: 1000, isPenalty: false })];
    assert.equal(calcKpiJurosMensais(list, 0, 10), 0);
  });
});

// ─── 2. Pagamento Parcial ────────────────────────────────────────────────────

describe('2. Pagamento Parcial', () => {
  test('R$70 em R$1070 taxa 10% -> saldo=1000, juro=100, carry=1100', () => {
    const r = calcPay(1070, 70, 10);
    assert.equal(r.isPartial, true);
    assert.equal(r.remainder, 1000);
    assert.equal(r.interestPart, 100);
    assert.equal(r.carry, 1100);
  });

  test('totalInterestToCarry sem carry anterior = interestPart', () => {
    assert.equal(calcPay(1070, 70, 10, 0).totalInterestToCarry, 100);
  });

  test('totalInterestToCarry com carry anterior acumula', () => {
    assert.equal(calcPay(1070, 70, 10, 50).totalInterestToCarry, 150);
  });

  test('proxima parcela recebe carry correto', () => {
    const { carry } = calcPay(1070, 70, 10);
    assert.equal(parseFloat((1070 + carry).toFixed(2)), 2170);
  });

  test('KPI juros mensais (partial) = 0 (juros ficam para a proxima parcela)', () => {
    const list = [mkInst({ status: 'partial', value: 1070, paidAmount: 70 })];
    assert.equal(calcKpiJurosMensais(list, 0, 10), 0);
  });

  test('jurosJaPagos = juro sobre saldo', () => {
    const list = [mkInst({ status: 'partial', value: 1070, paidAmount: 70 })];
    assert.equal(calcJurosJaPagos(list, 10), 100);
  });
});

// ─── 3. Nao Pagamento (Skip) unico ──────────────────────────────────────────

describe('3. Nao Pagamento (Skip) unico', () => {
  test('skip R$500 taxa 10% -> interest=50, carry=550', () => {
    const r = calcSkip(500, 10);
    assert.equal(r.interest, 50);
    assert.equal(r.carry, 550);
  });

  test('totalInterestToCarry sem carry anterior = interest', () => {
    assert.equal(calcSkip(500, 10, 0).totalInterestToCarry, 50);
  });

  test('jurosJaPagos conta skip', () => {
    const list = [mkInst({ status: 'skipped', value: 500 })];
    assert.equal(calcJurosJaPagos(list, 10), 50);
  });

  test('KPI skip = 0 (nao e pagamento recebido)', () => {
    const list = [mkInst({ status: 'skipped', value: 500 })];
    assert.equal(calcKpiJurosMensais(list, 0, 10), 0);
  });
});

// ─── 4. Cadeia de Skips (cenario exato reportado pelo usuario) ───────────────
//
//  P1(500) pago integral
//  P2(500) skip -> interest=50 -> P3.value=1050, P3.ci=50
//  P3(1050) pago -> KPI juros=50
//  P4(500) skip -> interest=50 -> P5.ci=50
//  P5(1050, ci=50) skip -> interest=105, totalToCarry=155 -> P6.ci=155
//  P6(1655, ci=155) skip -> interest=165.50, totalToCarry=320.50 -> P7.ci=320.50
//  P7(2320.50) pago -> KPI juros=320.50
//  P8(500) pago -> KPI juros=0
//  Total juros: 50 + 320.50 = 370.50

describe('4. Cadeia de Skips P4->P5->P6->P7', () => {
  function buildScenario() {
    const p1 = mkInst({ number:1, value:500, originalValue:500, status:'paid', paidDate:'2026-06-17', paidAmount:500 });

    const sk2 = calcSkip(500, 10, 0);
    const p2  = mkInst({ number:2, value:500, originalValue:500, status:'skipped', isPenalty:true, penaltyApplied:true });

    const v3 = parseFloat((500 + sk2.carry).toFixed(2));
    const p3 = mkInst({ number:3, value:v3, originalValue:500, status:'paid', paidDate:'2026-06-17', paidAmount:v3, isPenalty:true, carriedInterest:sk2.totalInterestToCarry });

    const sk4 = calcSkip(500, 10, 0);
    const p4  = mkInst({ number:4, value:500, originalValue:500, status:'skipped', isPenalty:true, penaltyApplied:true });

    const v5  = parseFloat((500 + sk4.carry).toFixed(2));
    const ci5 = sk4.totalInterestToCarry;
    const sk5 = calcSkip(v5, 10, ci5);
    const p5  = mkInst({ number:5, value:v5, originalValue:500, status:'skipped', isPenalty:true, penaltyApplied:true, carriedInterest:ci5 });

    const v6  = parseFloat((500 + sk5.carry).toFixed(2));
    const ci6 = sk5.totalInterestToCarry;
    const sk6 = calcSkip(v6, 10, ci6);
    const p6  = mkInst({ number:6, value:v6, originalValue:500, status:'skipped', isPenalty:true, penaltyApplied:true, carriedInterest:ci6 });

    const v7  = parseFloat((500 + sk6.carry).toFixed(2));
    const ci7 = sk6.totalInterestToCarry;
    const p7  = mkInst({ number:7, value:v7, originalValue:500, status:'paid', paidDate:'2026-06-17', paidAmount:v7, isPenalty:true, carriedInterest:ci7 });

    const p8 = mkInst({ number:8, value:500, originalValue:500, status:'paid', paidDate:'2026-06-17', paidAmount:500 });

    return [p1, p2, p3, p4, p5, p6, p7, p8];
  }

  test('valores acumulados corretos: P5=1050, P6=1655, P7=2320.50', () => {
    const list = buildScenario();
    assert.equal(list[4].value, 1050);
    assert.equal(list[5].value, 1655);
    assert.equal(list[6].value, 2320.50);
  });

  test('carriedInterest acumula: P5.ci=50, P6.ci=155, P7.ci=320.50', () => {
    const list = buildScenario();
    assert.equal(list[4].carriedInterest, 50);
    assert.equal(list[5].carriedInterest, 155);
    assert.equal(list[6].carriedInterest, 320.50);
  });

  test('calcSkip totalInterestToCarry encadeia: 50, 155, 320.50', () => {
    assert.equal(calcSkip(500,  10, 0).totalInterestToCarry,   50);
    assert.equal(calcSkip(1050, 10, 50).totalInterestToCarry,  155);
    assert.equal(calcSkip(1655, 10, 155).totalInterestToCarry, 320.50);
  });

  test('KPI P3 (skip P2) -> juros = 50', () => {
    const list = buildScenario();
    assert.equal(calcKpiJurosMensais(list, 2, 10), 50);
  });

  test('KPI P7 (cadeia P4+P5+P6) -> juros = 320.50 (nao 165.50)', () => {
    const list = buildScenario();
    assert.equal(calcKpiJurosMensais(list, 6, 10), 320.50);
  });

  test('KPI P8 (pagamento normal) -> juros = 0', () => {
    const list = buildScenario();
    assert.equal(calcKpiJurosMensais(list, 7, 10), 0);
  });

  test('jurosJaPagos total = 370.50', () => {
    const list = buildScenario();
    assert.equal(calcJurosJaPagos(list, 10), 370.50);
  });

  test('KPI total = jurosJaPagos (consistencia)', () => {
    const list = buildScenario();
    const kpi = [2, 6].reduce((s, i) => parseFloat((s + calcKpiJurosMensais(list, i, 10)).toFixed(2)), 0);
    assert.equal(kpi, 370.50);
    assert.equal(kpi, calcJurosJaPagos(list, 10));
  });
});

// ─── 5. Parcela Final ────────────────────────────────────────────────────────

describe('5. Parcela Final', () => {
  test('pagar ultima parcela integral -> carry=0', () => {
    assert.equal(calcPay(500, 500, 10).carry, 0);
  });

  test('jurosJaPagos = 0 quando tudo paid sem carry', () => {
    const list = [
      mkInst({ number:1, status:'paid', paidDate:'2026-05-15' }),
      mkInst({ number:2, status:'paid', paidDate:'2026-06-15' }),
    ];
    assert.equal(calcJurosJaPagos(list, 10), 0);
  });
});

// ─── 6. Multiplos Parciais Consecutivos ──────────────────────────────────────

describe('6. Multiplos Parciais Consecutivos', () => {
  test('carry acumulado em dois parciais encadeados', () => {
    const p1 = calcPay(1000, 200, 10, 0);
    assert.equal(p1.remainder, 800);
    assert.equal(p1.interestPart, 80);
    assert.equal(p1.carry, 880);
    assert.equal(p1.totalInterestToCarry, 80);

    const v2 = parseFloat((1000 + p1.carry).toFixed(2));
    const p2 = calcPay(v2, 500, 10, p1.totalInterestToCarry);
    assert.equal(p2.remainder, 1380);
    assert.equal(p2.interestPart, 138);
    assert.equal(p2.totalInterestToCarry, 218);
  });

  test('jurosJaPagos com dois parciais = soma dos saldos x taxa', () => {
    const list = [
      mkInst({ number:1, status:'partial', value:1000, paidAmount:200 }),
      mkInst({ number:2, status:'partial', value:1880, originalValue:1000, paidAmount:500, isPenalty:true, carriedInterest:80 }),
    ];
    assert.equal(calcJurosJaPagos(list, 10), 218);
  });
});

// ─── 7. Multa do Scheduler ───────────────────────────────────────────────────

describe('7. Multa do Scheduler (penaltyApplied)', () => {
  test('jurosJaPagos = value - originalValue', () => {
    const list = [mkInst({ status:'paid', value:1100, originalValue:1000, paidAmount:1100, isPenalty:true, penaltyApplied:true, penaltyRate:10 })];
    assert.equal(calcJurosJaPagos(list, 10), 100);
  });

  test('KPI juros = value - originalValue', () => {
    const list = [mkInst({ status:'paid', value:1100, originalValue:1000, paidAmount:1100, isPenalty:true, penaltyApplied:true, penaltyRate:10 })];
    assert.equal(calcKpiJurosMensais(list, 0, 10), 100);
  });
});

// ─── 8. Cadeia Mista: parcial -> skip -> paid ─────────────────────────────────

describe('8. Cadeia Mista: Parcial -> Skip -> Paid', () => {
  // P1 partial (paid 70 de 500) -> saldo=430, juro=43, carry=473, totalToCarry=43
  // P2 (500+473=973, ci=43) skip -> interest=97.30, totalToCarry=140.30
  // P3 (500+1070.30=1570.30, ci=140.30) paid

  test('calcPay parcial + calcSkip encadeado', () => {
    const p1 = calcPay(500, 70, 10, 0);
    assert.equal(p1.remainder, 430);
    assert.equal(p1.interestPart, 43);
    assert.equal(p1.totalInterestToCarry, 43);

    const v2 = parseFloat((500 + p1.carry).toFixed(2));
    const s2 = calcSkip(v2, 10, p1.totalInterestToCarry);
    assert.equal(v2, 973);
    assert.equal(s2.interest, 97.30);
    assert.equal(s2.totalInterestToCarry, 140.30);
  });

  test('KPI backward scan misto: skip(97.30) + partial(43) = 140.30', () => {
    const list = [
      mkInst({ number:1, status:'partial', value:500, paidAmount:70 }),
      mkInst({ number:2, status:'skipped', value:973, originalValue:500, isPenalty:true, carriedInterest:43 }),
      mkInst({ number:3, status:'paid',    value:1570.30, originalValue:500, paidAmount:1570.30, isPenalty:true, carriedInterest:140.30, paidDate:'2026-06-17' }),
    ];
    assert.equal(calcKpiJurosMensais(list, 2, 10), 140.30);
  });

  test('jurosJaPagos misto = 43 (partial) + 97.30 (skip) = 140.30', () => {
    const list = [
      mkInst({ number:1, status:'partial', value:500, paidAmount:70 }),
      mkInst({ number:2, status:'skipped', value:973, originalValue:500, isPenalty:true }),
      mkInst({ number:3, status:'paid',    value:1570.30, originalValue:500, paidAmount:1570.30, isPenalty:true, paidDate:'2026-06-17' }),
    ];
    assert.equal(calcJurosJaPagos(list, 10), 140.30);
  });
});

// ─── 9. Consistencia KPI <-> jurosJaPagos ────────────────────────────────────

describe('9. Consistencia KPI <-> jurosJaPagos', () => {
  test('skip unico: KPI=50, jurosJaPagos=50', () => {
    const list = [
      mkInst({ number:1, status:'skipped', value:500 }),
      mkInst({ number:2, status:'paid', value:1050, originalValue:500, paidAmount:1050, isPenalty:true, carriedInterest:50, paidDate:'2026-06-17' }),
    ];
    assert.equal(calcKpiJurosMensais(list, 1, 10), 50);
    assert.equal(calcJurosJaPagos(list, 10), 50);
  });

  test('sem juros: KPI=0, jurosJaPagos=0', () => {
    const list = [
      mkInst({ number:1, status:'paid', paidDate:'2026-06-10' }),
      mkInst({ number:2, status:'paid', paidDate:'2026-07-10' }),
    ];
    assert.equal(calcKpiJurosMensais(list, 0, 10), 0);
    assert.equal(calcKpiJurosMensais(list, 1, 10), 0);
    assert.equal(calcJurosJaPagos(list, 10), 0);
  });
});
