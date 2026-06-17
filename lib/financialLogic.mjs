/**
 * DebtFlow — Lógica Financeira Pura
 * Sem dependências de banco de dados — permite testes unitários isolados.
 */

/**
 * Calcula skip (não pagamento).
 * @param {number} instValue      - Valor atual da parcela
 * @param {number} interestRate   - Taxa de juros em %
 * @param {number} prevCarried    - carriedInterest acumulado nessa parcela
 */
export function calcSkip(instValue, interestRate, prevCarried = 0) {
  const value    = parseFloat(instValue)    || 0;
  const rate     = parseFloat(interestRate) || 0;
  const prev     = parseFloat(prevCarried)  || 0;
  const interest = parseFloat((value * rate / 100).toFixed(2));
  const carry    = parseFloat((value + interest).toFixed(2));
  const totalInterestToCarry = parseFloat((interest + prev).toFixed(2));
  return { interest, carry, totalInterestToCarry };
}

/**
 * Calcula pagamento (integral ou parcial).
 * @param {number} dueValue       - Valor devido
 * @param {number} payAmount      - Valor pago (null = integral)
 * @param {number} interestRate   - Taxa de juros em %
 * @param {number} prevCarried    - carriedInterest acumulado nessa parcela
 */
export function calcPay(dueValue, payAmount, interestRate, prevCarried = 0) {
  const due      = parseFloat(dueValue)     || 0;
  const paid     = payAmount != null ? parseFloat(payAmount) : due;
  const rate     = parseFloat(interestRate) || 0;
  const prev     = parseFloat(prevCarried)  || 0;
  const isPartial = paid < due - 0.009;

  if (!isPartial) {
    return { isPartial: false, remainder: 0, interestPart: 0, carry: 0, totalInterestToCarry: 0 };
  }

  const remainder    = parseFloat((due - paid).toFixed(2));
  const interestPart = parseFloat((remainder * rate / 100).toFixed(2));
  const carry        = parseFloat((remainder + interestPart).toFixed(2));
  const totalInterestToCarry = parseFloat((interestPart + prev).toFixed(2));
  return { isPartial: true, remainder, interestPart, carry, totalInterestToCarry };
}

/**
 * Calcula "Juros Já Pagos" de uma dívida.
 * - skipped  → value × rate/100
 * - partial  → saldo × rate/100
 * - paid + penaltyApplied + penaltyRate > 0 → value - originalValue
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
 * Calcula "Juros Mensais" para uma parcela no painel "Recebidos do Mês".
 * Usa backward-scan para paid+isPenalty — garante que todos os juros acumulados
 * numa cadeia de skips apareçam no mês do pagamento.
 *
 * @param {object[]} installmentList
 * @param {number}   idx             - Índice da parcela
 * @param {number}   interestRate
 */
export function calcKpiJurosMensais(installmentList, idx, interestRate) {
  const inst = installmentList[idx];
  const rate = parseFloat(interestRate) || 0;

  if (inst.status === 'partial') {
    const saldo = Math.max(0, (inst.value || 0) - (inst.paidAmount || 0));
    return parseFloat((saldo * rate / 100).toFixed(2));
  }

  if (inst.status === 'paid') {
    if (inst.penaltyApplied && inst.penaltyRate > 0) {
      return Math.max(0, (inst.value || 0) - (inst.originalValue || 0));
    }

    if (inst.isPenalty) {
      let juros = 0;
      for (let j = idx - 1; j >= 0; j--) {
        const prev = installmentList[j];
        if (prev.status === 'skipped') {
          juros = parseFloat((juros + (prev.value || 0) * rate / 100).toFixed(2));
        } else if (prev.status === 'partial') {
          const prevSaldo = Math.max(0, (prev.value || 0) - (prev.paidAmount || 0));
          juros = parseFloat((juros + prevSaldo * rate / 100).toFixed(2));
          break;
        } else {
          break;
        }
      }
      return parseFloat(juros.toFixed(2));
    }
  }

  return 0;
}
