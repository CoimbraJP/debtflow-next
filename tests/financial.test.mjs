/**
 * DebtFlow — Testes Financeiros
 * Executa com: npm test  (ou: node --test tests/financial.test.mjs)
 *
 * Cenários cobertos:
 *   1. Pagamento integral
 *   2. Pagamento parcial
 *   3. Não pagamento (skip)
 *   4. Pagamento da parcela com juros carregados (skip → paga)
 *   5. Pagamento sem juros (parcela normal)
 *   6. Parcela final — quitação da dívida
 *   7. Múltiplos pagamentos parciais consecutivos
 *   8. jurosJaPagos — todos os status
 *   9. KPI "Juros Mensais" — coluna do painel Recebidos do Mês
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcSkip,
  calcPay,
  calcJurosJaPagos,
  calcKpiJurosMensais,
} from '../lib/financialLogic.mjs';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Monta parcela básica para testes */
function inst(overrides = {}) {
  return {
    number: 1, value: 1000, originalValue: 1000, dueDate: '2026-06-15',
    status: 'pending', isPenalty: false, penaltyRate: 0, penaltyApplied: false,
    paidDate: null, paidAmount: null, carriedInterest: 0,
    ...overrides,
  };
}

// ─── 1. Pagamento Integral ───────────────────────────────────────────────────

describe('Pagamento Integral', () => {
  test('pagar valor cheio → isPartial=false, carry=0', () => {
    const r = calcPay(1000, 1000, 10);
    assert.equal(r.isPartial, false);
    assert.equal(r.carry, 0);
    assert.equal(r.interestPart, 0);
    assert.equal(r.remainder, 0);
  });

  test('pagar null (sem informar valor) → tratado como integral', () => {
    const r = calcPay(1000, null, 10);
    assert.equal(r.isPartial, false);
  });

  test('tolerância de 1 centavo — R$999,99 não é parcial em parcela de R$1000,00', () => {
    const r = calcPay(1000, 999.999, 10);
    assert.equal(r.isPartial, false, 'diferença < 0.009 → integral');
  });

  test('KPI juros mensais → 0 para pagamento integral sem carry', () => {
    const parcela = inst({ status: 'paid', paidAmount: 1000 });
    assert.equal(calcKpiJurosMensais(parcela, 10), 0);
  });
});

// ─── 2. Pagamento Parcial ────────────────────────────────────────────────────

describe('Pagamento Parcial', () => {
  test('pagar R$70 em parcela de R$1070 com taxa 10%', () => {
    // saldo = 1000, juro = 100, carry = 1100
    const r = calcPay(1070, 70, 10);
    assert.equal(r.isPartial, true);
    assert.equal(r.remainder, 1000);
    assert.equal(r.interestPart, 100);
    assert.equal(r.carry, 1100);
  });

  test('pagar R$500 em parcela de R$1000 com taxa 5%', () => {
    // saldo = 500, juro = 25, carry = 525
    const r = calcPay(1000, 500, 5);
    assert.equal(r.isPartial, true);
    assert.equal(r.remainder, 500);
    assert.equal(r.interestPart, 25);
    assert.equal(r.carry, 525);
  });

  test('próxima parcela recebe carry corretamente', () => {
    const { interestPart, carry } = calcPay(1070, 70, 10);
    // Simula o que a rota faz na nextInst
    const nextVal = parseFloat((1070 + carry).toFixed(2));
    assert.equal(nextVal, 2170);           // 1070 (própria) + 1000 (saldo) + 100 (juro)
    assert.equal(interestPart, 100);       // carriedInterest = 100
  });

  test('KPI juros mensais de pagamento parcial = juro sobre saldo', () => {
    const parcela = inst({ status: 'partial', value: 1070, paidAmount: 70 });
    // saldo = 1000, juro = 1000*10% = 100
    assert.equal(calcKpiJurosMensais(parcela, 10), 100);
  });

  test('jurosJaPagos para parcela partial = juro sobre saldo', () => {
    const list = [inst({ status: 'partial', value: 1070, paidAmount: 70 })];
    assert.equal(calcJurosJaPagos(list, 10), 100);
  });
});

// ─── 3. Não Pagamento (Skip) ─────────────────────────────────────────────────

describe('Não Pagamento (Skip)', () => {
  test('skip de R$1070 com taxa 10% → juro=107, carry=1177', () => {
    const r = calcSkip(1070, 10);
    assert.equal(r.interest, 107);
    assert.equal(r.carry, 1177);
  });

  test('skip de R$500 com taxa 5% → juro=25, carry=525', () => {
    const r = calcSkip(500, 5);
    assert.equal(r.interest, 25);
    assert.equal(r.carry, 525);
  });

  test('próxima parcela recebe o carry certo após skip', () => {
    const { carry, interest } = calcSkip(1070, 10);
    const nextVal          = parseFloat((1070 + carry).toFixed(2));
    const nextCarried      = interest;
    assert.equal(nextVal, 2247);   // 1070 + 1070 + 107
    assert.equal(nextCarried, 107);
  });

  test('jurosJaPagos conta juro da parcela skipada', () => {
    const list = [inst({ status: 'skipped', value: 1070 })];
    assert.equal(calcJurosJaPagos(list, 10), 107);
  });

  test('KPI juros mensais de parcela skipada = 0 (skip não é pagamento recebido)', () => {
    // Parcelas skipped não aparecem no painel Recebidos do Mês
    const parcela = inst({ status: 'skipped', value: 1070 });
    assert.equal(calcKpiJurosMensais(parcela, 10), 0);
  });
});

// ─── 4. Pagamento da Parcela com Juros Carregados (Skip → Paga) ─────────────

describe('Pagamento com Juros de Skip Anterior', () => {
  /**
   * Cenário: Parcela 1 (R$1070) skipada → Parcela 2 recebe carry.
   * Parcela 2 original = R$1070, após carry = R$2247, carriedInterest = R$107.
   * Usuário paga R$2247 integralmente.
   */
  test('parcela 2 após skip: valor total correto', () => {
    const { carry } = calcSkip(1070, 10);
    const nextValue = parseFloat((1070 + carry).toFixed(2));
    assert.equal(nextValue, 2247);
  });

  test('pagamento integral de R$2247 → isPartial=false', () => {
    const r = calcPay(2247, 2247, 10);
    assert.equal(r.isPartial, false);
  });

  test('KPI juros mensais = carriedInterest (R$107) quando parcela paga tem carry de skip', () => {
    const parcela = inst({
      status: 'paid', value: 2247, originalValue: 1070,
      paidAmount: 2247, carriedInterest: 107,
      isPenalty: true, penaltyApplied: false, penaltyRate: 0,
    });
    // ANTES da correção: mostrava 0 (bug)
    // DEPOIS da correção: mostra 107
    assert.equal(calcKpiJurosMensais(parcela, 10), 107);
  });

  test('jurosJaPagos NÃO duplica: conta via parcela skipada, não via paid', () => {
    const list = [
      inst({ status: 'skipped', value: 1070 }),
      inst({
        number: 2, status: 'paid', value: 2247, originalValue: 1070,
        paidAmount: 2247, carriedInterest: 107, isPenalty: true,
      }),
    ];
    // Conta 107 da skipada. A paid não adiciona (penaltyApplied=false). Total = 107.
    assert.equal(calcJurosJaPagos(list, 10), 107);
  });
});

// ─── 5. Pagamento Sem Juros ──────────────────────────────────────────────────

describe('Pagamento Sem Juros (parcela normal)', () => {
  test('KPI juros mensais = 0 para parcela paid sem carry e sem penaltyApplied', () => {
    const parcela = inst({ status: 'paid', paidDate: '2026-06-10' });
    assert.equal(calcKpiJurosMensais(parcela, 10), 0);
  });

  test('jurosJaPagos = 0 para lista com apenas parcelas paid normais', () => {
    const list = [
      inst({ status: 'paid', paidDate: '2026-06-10' }),
      inst({ number: 2, status: 'paid', paidDate: '2026-07-10' }),
    ];
    assert.equal(calcJurosJaPagos(list, 10), 0);
  });
});

// ─── 6. Parcela Final (quitação) ─────────────────────────────────────────────

describe('Parcela Final', () => {
  test('pagar última parcela integralmente → isPartial=false, carry=0', () => {
    const r = calcPay(1070, 1070, 10);
    assert.equal(r.isPartial, false);
    assert.equal(r.carry, 0);
  });

  test('jurosJaPagos = 0 quando todas as parcelas estão paid sem penaltyApplied', () => {
    const list = [
      inst({ number: 1, status: 'paid', paidDate: '2026-05-15' }),
      inst({ number: 2, status: 'paid', paidDate: '2026-06-15' }),
      inst({ number: 3, status: 'paid', paidDate: '2026-07-15' }),
    ];
    assert.equal(calcJurosJaPagos(list, 10), 0);
  });

  test('jurosJaPagos acumula: 1 skip + 2 paid normais = 107', () => {
    const list = [
      inst({ number: 1, status: 'skipped', value: 1070 }),
      inst({ number: 2, status: 'paid', value: 2247, originalValue: 1070, paidAmount: 2247, carriedInterest: 107, isPenalty: true }),
      inst({ number: 3, status: 'paid', value: 1070, originalValue: 1070, paidDate: '2026-08-15' }),
    ];
    assert.equal(calcJurosJaPagos(list, 10), 107);
  });
});

// ─── 7. Múltiplos Pagamentos Parciais ────────────────────────────────────────

describe('Múltiplos Pagamentos Parciais Consecutivos', () => {
  /**
   * Parcela 1 (R$1000): paga R$200 → saldo R$800, juro R$80, carry R$880
   * Parcela 2 (R$1000): recebe carry → valor R$1880, carriedInterest=R$80
   *   Parcela 2: paga R$500 → saldo R$1380, juro R$138, carry R$1518
   * Parcela 3 (R$1000): recebe carry → valor R$2518, carriedInterest=R$80+R$138=R$218
   */
  test('carry acumulado em múltiplos parciais', () => {
    // 1ª parcial
    const p1 = calcPay(1000, 200, 10);
    assert.equal(p1.remainder, 800);
    assert.equal(p1.interestPart, 80);
    assert.equal(p1.carry, 880);

    // Parcela 2 recebe carry
    const v2 = parseFloat((1000 + p1.carry).toFixed(2));  // 1880
    const ci2 = p1.interestPart;                          // 80
    assert.equal(v2, 1880);

    // 2ª parcial em parcela 2
    const p2 = calcPay(v2, 500, 10);
    assert.equal(p2.remainder, 1380);
    assert.equal(p2.interestPart, 138);
    assert.equal(p2.carry, 1518);

    // Parcela 3 recebe carry acumulado
    const v3  = parseFloat((1000 + p2.carry).toFixed(2));    // 2518
    const ci3 = parseFloat((ci2 + p2.interestPart).toFixed(2)); // 218
    assert.equal(v3, 2518);
    assert.equal(ci3, 218);
  });

  test('KPI juros mensais de parcela com carry acumulado', () => {
    const parcela = inst({
      status: 'paid', value: 2518, originalValue: 1000,
      paidAmount: 2518, carriedInterest: 218, isPenalty: true,
    });
    assert.equal(calcKpiJurosMensais(parcela, 10), 218);
  });

  test('jurosJaPagos com 2 partials e 1 paid final', () => {
    const list = [
      inst({ number: 1, status: 'partial', value: 1000, paidAmount: 200 }),
      inst({ number: 2, status: 'partial', value: 1880, originalValue: 1000, paidAmount: 500, carriedInterest: 80 }),
      inst({ number: 3, status: 'paid',    value: 2518, originalValue: 1000, paidAmount: 2518, carriedInterest: 218, isPenalty: true }),
    ];
    // partial 1: saldo=800, juro=80
    // partial 2: saldo=1380, juro=138
    // paid 3: penaltyApplied=false → não conta
    // Total esperado: 80 + 138 = 218
    assert.equal(calcJurosJaPagos(list, 10), 218);
  });
});

// ─── 8. Scheduler (penaltyApplied) ───────────────────────────────────────────

describe('Multa do Scheduler (5+ dias atraso)', () => {
  test('jurosJaPagos conta penalty de parcela paid com penaltyApplied', () => {
    const list = [
      inst({
        status: 'paid', value: 1100, originalValue: 1000,
        paidDate: '2026-06-20', paidAmount: 1100,
        isPenalty: true, penaltyApplied: true, penaltyRate: 10,
      }),
    ];
    // juro = 1100 - 1000 = 100
    assert.equal(calcJurosJaPagos(list, 10), 100);
  });

  test('KPI juros mensais = value - originalValue quando penaltyApplied', () => {
    const parcela = inst({
      status: 'paid', value: 1100, originalValue: 1000,
      paidAmount: 1100, isPenalty: true, penaltyApplied: true, penaltyRate: 10,
    });
    assert.equal(calcKpiJurosMensais(parcela, 10), 100);
  });
});

// ─── 9. Consistência entre KPI e jurosJaPagos ────────────────────────────────

describe('Consistência KPI ↔ jurosJaPagos', () => {
  test('skip+paid: KPI mostra 107 (mês do pagamento), jurosJaPagos mostra 107 (total dívida)', () => {
    const list = [
      inst({ status: 'skipped', value: 1070 }),
      inst({ number: 2, status: 'paid', value: 2247, originalValue: 1070,
             paidAmount: 2247, carriedInterest: 107, isPenalty: true,
             paidDate: '2026-06-20' }),
    ];
    const totalJuros = calcJurosJaPagos(list, 10);
    const kpiJuros   = calcKpiJurosMensais(list[1], 10);

    // Ambos devem convergir para o mesmo valor de juro
    assert.equal(totalJuros, 107);
    assert.equal(kpiJuros, 107);
    assert.equal(totalJuros, kpiJuros, 'KPI e jurosJaPagos devem coincidir no cenário de skip→paid');
  });

  test('partial+paid: KPI mês1=100 (partial), KPI mês2=100 (paid carry), jurosJaPagos=100', () => {
    const listComPartial = [
      inst({ status: 'partial', value: 1070, paidAmount: 70 }),
      inst({ number: 2, status: 'paid', value: 2170, originalValue: 1070,
             paidAmount: 2170, carriedInterest: 100, isPenalty: true,
             paidDate: '2026-07-20' }),
    ];

    // jurosJaPagos conta via partial (saldo * rate = 100)
    assert.equal(calcJurosJaPagos(listComPartial, 10), 100);

    // KPI mês 1: parcela partial mostra 100 de juro futuro
    assert.equal(calcKpiJurosMensais(listComPartial[0], 10), 100);

    // KPI mês 2: parcela paid com carry mostra 100 de juro cobrado
    assert.equal(calcKpiJurosMensais(listComPartial[1], 10), 100);
  });
});
