/**
 * DebtFlow — Lógica Financeira Pura
 * Funções extraídas das rotas de skip/pay para permitir testes unitários.
 * Não têm dependências de banco de dados.
 */

/**
 * Calcula skip (não pagamento): valor + juros transferido para a próxima parcela.
 * Equivalente à rota POST /api/debts/:id/skip/:idx
 */
export function calcSkip(instValue, interestRate) {
  const value    = parseFloat(instValue)    || 0;
  const rate     = parseFloat(interestRate) || 0;
  const interest = parseFloat((value * rate / 100).toFixed(2));
  const carry    = parseFloat((value + interest).toFixed(2));
  return { interest, carry };
}

/**
 * Calcula pagamento (integral ou parcial).
 * Equivalente à rota POST /api/debts/:id/pay/:idx
 *
 * Retorna:
 *   isPartial       — se o pagamento foi parcial
 *   remainder       — saldo não pago
 *   interestPart    — juro sobre o saldo (vai para carriedInterest da próxima)
 *   carry           — saldo + juro transferido para a próxima parcela
 */
export function calcPay(dueValue, payAmount, interestRate) {
  const due      = parseFloat(dueValue)     || 0;
  const paid     = payAmount != null ? parseFloat(payAmount) : due;
  const rate     = parseFloat(interestRate) || 0;
  const isPartial = paid < due - 0.009;

  if (!isPartial) {
    return { isPartial: false, remainder: 0, interestPart: 0, carry: 0 };
  }

  const remainder    = parseFloat((due - paid).toFixed(2));
  const interestPart = parseFloat((remainder * rate / 100).toFixed(2));
  const carry        = parseFloat((remainder + interestPart).toFixed(2));
  return { isPartial: true, remainder, interestPart, carry };
}

/**
 * Calcula "Juros Já Pagos" de uma dívida inteira — mesma fórmula usada em page.js.
 *
 * Conta:
 *   - skipped  → juro = instValue * rate/100  (interesse que SERÁ cobrado ao carregar)
 *   - partial  → juro = saldo * rate/100       (saldo restante × taxa)
 *   - paid + penaltyApplied + penaltyRate > 0 → juro = value - originalValue (multa scheduler)
 */
export function calcJurosJaPagos(installmentList, interestRate) {
  const rate = parseFloat(interestRate) || 0;
  let interest = 0;

  for (const inst of installmentList) {
    if (inst.status === 'skipped') {
      interest += parseFloat(((inst.value || 0) * rate / 100).toFixed(2));
    } else if (inst.status === 'partial') {
      const saldo = Math.max(0, (inst.value || 0) - (inst.paidAmount || 0));
      interest += parseFloat((saldo * rate / 100).toFixed(2));
    } else if (inst.status === 'paid' && inst.penaltyApplied && inst.penaltyRate > 0) {
      interest += Math.max(0, (inst.value || 0) - (inst.originalValue || 0));
    }
  }

  return Math.max(0, parseFloat(interest.toFixed(2)));
}

/**
 * Calcula "Juros Mensais" para uma parcela no painel "Recebidos do Mês" — mesma
 * lógica usada em page.js (kpiPanel === 'received').
 *
 * Cobre três origens de juros:
 *   1. partial       → juro futuro sobre saldo restante
 *   2. paid + penaltyApplied → multa do scheduler
 *   3. paid + carriedInterest > 0 → juro carregado de skip/parcial anterior
 */
export function calcKpiJurosMensais(inst, interestRate) {
  const rate = parseFloat(interestRate) || 0;

  if (inst.status === 'partial') {
    const saldo = Math.max(0, (inst.value || 0) - (inst.paidAmount || 0));
    return parseFloat((saldo * rate / 100).toFixed(2));
  }

  if (inst.status === 'paid') {
    if (inst.penaltyApplied && inst.penaltyRate > 0) {
      return Math.max(0, (inst.value || 0) - (inst.originalValue || 0));
    }
    if ((inst.carriedInterest || 0) > 0) {
      return inst.carriedInterest;
    }
  }

  return 0;
}
