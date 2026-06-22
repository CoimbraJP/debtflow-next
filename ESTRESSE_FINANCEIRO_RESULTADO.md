# Estresse da Lógica Financeira — Resultado Executado

**Método:** a lógica de produção (`pay`, `skip`, scheduler, criação e edição) e os calculadores de **cada janela** do `page.js` (Dashboard, Lista de Dívidas, Painel da Dívida, Relatório "Recebido no Mês") foram **portados fielmente** para um harness em Node e **executados** contra 15 cenários, com verificação dupla por invariantes (conservação de dinheiro + igualdade dos números entre janelas).

**Harness reproduzível:** `stress-financeiro.mjs` (rode com `node stress-financeiro.mjs`).

**Placar:** **35 checagens OK · 19 falhas.**

> Conclusão de uma linha: a **aritmética dos valores está correta no miolo** (transferência de saldo+juros, crédito de pagamento a maior, e os números monetários batem entre todas as janelas), mas há **6 quebras que produzem valores incorretos** e **2 inconsistências de exibição entre janelas**. O sistema ainda **não** está matematicamente confiável para entrega.

---

## ✅ O que está comprovadamente correto (com números executados)

| Cenário | Verificado | Resultado |
|---|---|---|
| Pagamento integral (100) | status `paid`, recebido 100 | ✅ |
| Parcial sem juros (paga 40 de 100) | saldo 60 → próxima vira 160 | ✅ |
| Parcial com juros 10% (paga 40) | saldo 60 + juros 6 = **66** → próxima vira **166,00** | ✅ |
| Não pagou sem juros (100) | 100 → próxima vira 200 | ✅ |
| Não pagou com juros 10% (100) | 100 + 10 = **110** → próxima vira **210,00** | ✅ |
| 3 atrasos consecutivos (4×100, 10%) | acúmulo 210 → 331 → **464,10**; ao pagar a 4ª, conservação fecha | ✅ |
| Pagamento a MAIOR (paga 250) | crédito propagado **sem juros**, parcela coberta marcada `creditPaid` (não dobra no recebido) | ✅ |
| **Conservação de dinheiro** | caixa + aberto = principal + juros cobrados | ✅ em todos, **exceto última parcela** |
| **Cross-window de VALORES** | "Aberto" do painel = "Total em Aberto" do dashboard; "Recebido" do dashboard = "Recebido" do relatório | ✅ inclusive no **agregado de 3 clientes** (totalOpen 627,25 = soma dos painéis; recebido 380,00 = soma do relatório) |

Ou seja: **os números de dinheiro de um mesmo cliente são iguais no Dashboard, na Lista, no Painel e no Relatório.** Essa parte passou em 100% das checagens.

---

## 🔴 Bugs Críticos — geram valores incorretos (confirmados na execução)

### C-1 · Última parcela: dinheiro evapora e a dívida é dada como quitada
- **Pagamento parcial na última parcela:** caixa 140 + aberto 0 = **140**, mas o esperado era principal 200 + juros 6 = **206**. **Saldo perdido: R$ 60,00.** Status virou `paid`.
- **"Não Pagou" na última parcela:** caixa 100 + aberto 0 = **100**, esperado **210**. **Principal perdido: R$ 100,00 + juros R$ 10,00.** Status virou `paid`.
- **Causa:** `pay`/`skip` transferem o saldo para "a próxima parcela em aberto"; na última não há próxima, e o `carry` não vai a lugar nenhum. Como `skipped`/`partial` contam em `allSettled`, a dívida é marcada quitada.

### C-2 · Digitar "0" no pagamento vira pagamento INTEGRAL
- **Execução:** modal com "Valor Pago = 0" → o front envia `parseFloat('0') || null = null` → o backend trata `null` como pagamento cheio → parcela vira `paid` com R$ 100,00.
- **Impacto:** quem tenta registrar "recebi zero" acaba **quitando** a parcela.

### C-3 · Editar um campo inócuo (ex.: observação) apaga os saldos transferidos
- **Execução:** dívida com "Não Pagou" na P1 (P2 estava com **210,00**). Editar só o campo `notes` → `regenerou parcelas? **true**` → P2 voltou para **100,00**. **Carry de 110,00 perdido.**
- **Causa:** a comparação de data sempre falha (o `createdAt` é `Date` no servidor; `String(Date).slice(0,10)` nunca é `'YYYY-MM-DD'`), então **toda** edição regenera; a regeneração não restaura `value`/`carriedInterest`.

### C-4 · Repetir o pagamento (duplo clique / retry) reaplica os juros
- **Execução:** parcial na P1 → P2 = **166,00**; repetindo o mesmo parcial → P2 = **232,00** (somou +66 de novo). Não há trava de idempotência.
- **Impacto:** duplo clique ou reenvio infla a dívida do cliente.

### C-5 · Soma das parcelas não fecha com o total
- **Execução:** total 100 em 3 parcelas → 33,33 + 33,33 + 33,33 = **99,99 ≠ 100,00**. Nenhuma parcela absorve o centavo residual.

### C-6 · Dívida com 0% de juros é cobrada pelo motor automático
- **Execução:** dívida `interestRate = 0`, parcela vencida 5+ dias → scheduler aplica **2%** (fallback `|| 2`): parcela 100,00 → **102,00**. Diverge do caminho manual, que respeita 0%.

---

## 🟠 Inconsistências entre janelas — mesmo cliente, número diferente

### W-1 · Contagem de "parcelas pagas" difere entre a Lista e o Painel
A **Lista de Dívidas** conta só `status === 'paid'`; o **Painel da Dívida** conta `paid + partial + skipped`. Para o mesmo cliente:

| Situação do cliente | Lista mostra | Painel mostra |
|---|---|---|
| 1 parcial (cenário C3) | **0/2** | **1/2** |
| 1 "não pagou" (C4/C5) | **0/2** | **1/2** |
| 1 paga + 1 parcial + 1 skip (C11) | **1/4** | **3/4** |
| chain de 3 skips + 1 paga (C6) | **1/4** | **4/4** |

O mesmo cliente aparece com progresso diferente conforme a tela. A barra de progresso herda a mesma divergência.

### W-2 · "Juros já pagos" mostra juros que NÃO foram recebidos
O rótulo "Juros já pagos" (Painel) soma juros ainda **pendentes** em parcelas `skipped`/`partial`, enquanto o relatório "Recebido no Mês" mostra **0** para os mesmos (juros só entram quando a parcela que os carrega é paga). Execução:

| Cliente | Painel "Juros já pagos" | Juros realmente recebido |
|---|---|---|
| C3 (1 parcial) | R$ 6,00 | **R$ 0,00** |
| C5 (1 não pagou) | R$ 10,00 | **R$ 0,00** |
| C11 (parcial + skip) | R$ 22,60 | **R$ 0,00** |
| C14 (scheduler + skip) | R$ 11,00 | juros real cobrado **R$ 21,00** |

No caso C14 o número exibido fica **abaixo** do juros efetivamente lançado na dívida (11 vs 21). Em todos os outros, fica **acima** do que entrou em caixa. O rótulo "já pagos" não corresponde ao valor.

> Observação: quando uma cadeia de atrasos termina em pagamento integral, "Juros já pagos" passa a coincidir com o juros recebido (a matemática converge). O problema aparece **enquanto** há parcelas pendentes — exatamente quando o operador consulta o cliente.

---

## TOP 10 prioridades para tornar a lógica confiável e os números iguais em todas as janelas

1. **Não perder saldo na última parcela.** Sem "próxima", criar parcela de rolagem (ou manter saldo em aberto) e nunca marcar como quitada com saldo > 0. *(C-1)*
2. **Não tratar `skipped` como quitação.** Só quitar quando o saldo real for zero. *(C-1)*
3. **Tratar "0" como não pagamento, não como integral.** Distinguir campo vazio de zero no fluxo de pagamento. *(C-2)*
4. **Não regenerar parcelas em edição que não muda cronograma**, e ao regenerar **preservar** `value`/`carriedInterest`/`isPenalty`. Corrigir a comparação de data. *(C-3)*
5. **Idempotência.** Bloquear pagamento/skip em parcela já em estado final; usar atualização atômica para duplo clique/retry. *(C-4)*
6. **Fechar o arredondamento.** Distribuir o resíduo de centavos (ex.: na última parcela), garantindo soma = total. *(C-5)*
7. **Unificar a taxa de juros e respeitar 0%.** Eliminar o fallback `|| 2`; mesma taxa no scheduler, skip e parcial. *(C-6)*
8. **Padronizar a contagem de "parcelas pagas"** entre Lista e Painel (uma única definição) para o mesmo cliente exibir o mesmo X/Y em qualquer tela. *(W-1)*
9. **Separar "juros recebidos" de "juros acumulados/pendentes"** e renomear o rótulo "Juros já pagos" para que o número corresponda ao que realmente entrou. *(W-2)*
10. **Unificar a lógica num único módulo** importado por rotas e telas, e **rodar este harness (todos os cenários) no CI** antes de cada entrega — hoje os testes existentes cobrem só a versão "pura", que não é a executada em produção.

---

### Como reexecutar a verificação
`node stress-financeiro.mjs` (na pasta `debtflow-next`). O script imprime cada cenário com os valores e, ao final, o placar e a lista de falhas. Ele replica a lógica atual — conforme os bugs forem corrigidos no código real, replique a correção no harness (ou aponte-o para os módulos reais) e o placar deve chegar a **0 falhas**.
