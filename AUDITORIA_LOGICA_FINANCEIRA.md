# Auditoria de Lógica Financeira e Usabilidade — DebtFlow

**Escopo exclusivo:** lógica financeira, consistência de dados, fluxos de uso e experiência durante operações financeiras.
**Fora de escopo (não avaliado):** segurança, design visual, performance, novas funcionalidades.
**Modo:** somente leitura — nenhum arquivo alterado.
**Data:** 18/06/2026

Equipe simulada: Arquiteto de Software Sênior · Especialista em Sistemas Financeiros · QA Sênior · Analista de Regras de Negócio · Especialista em UX para Gestão.

---

## ETAPA 1 — Mapeamento do funcionamento atual

### 1.1 Como uma dívida é criada
`POST /api/debts` (`app/api/debts/route.js`). Recebe `name, phone, address, product, total, installments, dueDay, interestRate, startDate, paidInstallments`. Valida obrigatórios e `dueDay ∈ [1,28]`. Calcula `paidCount = min(paidInstallments, installments)`. Persiste com `interestRate` padrão 10 se ausente, `status = paidCount >= installments ? 'paid' : 'pending'`, e `createdAt = startDate` (string). Gera a lista de parcelas e grava um registro em `Activity`.

Observação estrutural: `createdAt` é, ao mesmo tempo, a "data de início do negócio" e o timestamp do Mongoose (`timestamps: true`) — os dois conceitos estão fundidos no mesmo campo.

### 1.2 Como as parcelas são geradas
Função `generateInstallments` — **existe em duas versões diferentes**:
- **Na criação** (`debts/route.js`): valor de cada parcela `instValue = round(total / installments, 2)`. Calcula o 1º vencimento com lógica "smart": se `dueDay <= dia do cadastro`, a 1ª parcela cai no mês seguinte; senão no mês atual. Marca as primeiras `paidCount` como `paid` (com `paidDate = data de vencimento`, `paidAmount` **não definido**, `penaltyApplied/dueSent/overdueSent = true`).
- **Na edição** (`debts/[id]/route.js`): mesmo `instValue`, mas **sem** a lógica "smart" — começa o 1º vencimento a partir do `startDate` direto.

Cada parcela carrega: `number, value, originalValue, dueDate, status, isPenalty, penaltyRate, penaltyApplied, dueSent, overdueSent, paidDate, paidAmount, carriedInterest, creditPaid`.

### 1.3 Como os juros são calculados
Há **dois modelos distintos de juros**, dependendo do caminho:
- **Automático / atraso (scheduler, `lib/scheduler.js`):** quando uma parcela passa de 5 dias de atraso e ainda não teve penalidade, o **valor da própria parcela é inflado** `value = round(value × (1 + rate/100), 2)`, o vencimento é empurrado +1 mês, `isPenalty=true`, `penaltyRate=rate`, `penaltyApplied=true`, e a parcela volta a `pending`. Aplicado **uma única vez** por parcela. Usa `rate = debt.interestRate || 2`.
- **Manual "Não Pagou" (skip) e pagamento parcial:** os juros incidem sobre o saldo não pago e o **saldo + juros é transferido para a PRÓXIMA parcela em aberto** (a parcela atual não muda de valor). Usa `rate = debt.interestRate || 0`.

A lógica "pura" vive em `lib/financialLogic.mjs` (`calcSkip`, `calcPay`, `calcJurosJaPagos`, `calcKpiJurosMensais`), mas **as rotas de produção não a importam** — reimplementam o cálculo inline. O front (`app/page.js`) reimplementa de novo.

### 1.4 Como pagamentos são processados
`POST /api/debts/[id]/pay/[idx]`. `dueValue = inst.value`. `payAmount = (body.payAmount > 0) ? body.payAmount : dueValue`. Classifica: `isPartial = pay < due − 0,009`, `isOver = pay > due + 0,009`.
- **Integral:** `status='paid'`, `paidAmount=pay`, sem carry.
- **A maior (over):** crédito = `pay − due` propagado às próximas parcelas: cobre integralmente parcelas seguintes marcando-as `paid` + `creditPaid=true` (não somam no "recebido"), ou reduz o valor da próxima (adiantamento **sem juros**).
- Recalcula `status` da dívida e grava `Activity`.

### 1.5 Como pagamentos parciais são processados
`status='partial'`, `paidAmount=pay`, **a parcela mantém `value` original**. `remainder = due − pay`; `interestPart = round(remainder × rate/100, 2)`; `carry = remainder + interestPart`. Na próxima parcela em aberto: `value += carry`, `isPenalty=true`, `carriedInterest += interestPart (+ carriedInterest anterior)`.
No front, se `pay < due`, há uma **tela de preview** mostrando saldo, juros e total transferido antes de confirmar.

### 1.6 Como parcelas futuras são afetadas
Skip e parcial **empilham** saldo+juros na próxima parcela em aberto, que tem o `value` aumentado e `carriedInterest` acumulado. Cadeias consecutivas compõem (juros incidem sobre valores que já contêm juros anteriores → **juros sobre juros / capitalização**). O scheduler, por outro caminho, infla a própria parcela e rola a data.

### 1.7 Como o dashboard calcula valores (`app/page.js`, `useMemo`)
- **Total em Aberto:** soma `i.value` das parcelas **não** em `paid/partial/skipped`.
- **Recebido no Mês:** soma `(paidAmount ?? value)` de parcelas `paid/partial` com `paidDate` no mês corrente e `!creditPaid`.
- **Inadimplentes:** conta parcelas em aberto com `dueDate < hoje`.
- **Vence em 5 dias:** parcelas em aberto com `0 ≤ diff ≤ 5`.
- **Gráfico (6 meses):** mesma fórmula do "Recebido".

### 1.8 Como os relatórios calculam valores (painéis de KPI clicáveis)
- **Recebido:** linhas com `(paidAmount ?? value)` e cálculo de **juros mensais** por parcela: se `paid + penaltyApplied + penaltyRate>0` → `value − originalValue`; senão se `paid + isPenalty` → **varredura para trás** somando juros das parcelas `skipped/partial` que alimentaram esta; partial → juros 0 (pendente).
- **Inadimplentes / Vence em 5 dias:** listam parcelas em aberto por `diff`.

### 1.9 Como o painel da dívida calcula (`DebtPanel`)
- **Pago:** soma `(paidAmount ?? value)` de `paid/partial` com `!creditPaid`.
- **Aberto:** soma `value` das não liquidadas.
- **Juros já pagos:** `skipped → value×rate`; `partial → saldo×rate`; `paid c/ penaltyRate>0 → value−originalValue`.

> Modelo de consistência pretendido (declarado nos testes): **`jurosJaPagos = juros recebidos (KPI) + juros pendentes`** — ou seja, "Juros já pagos" na verdade significa *juros acumulados/incidentes*, incluindo os ainda **não** recebidos.

### 1.10 Como os históricos são registrados
Cada operação grava `Activity` (texto + tipo): criação, pagamento (integral/parcial/antecipado), "Não Pagou", edição/regeneração, quitação. É um log textual, sem saldo corrente. Eventos do scheduler tentam ser logados **sem `tenant`** (campo obrigatório) — não chegam a ser registrados para o tenant.

---

## ETAPA 2 — Consistência entre as fontes

**O que está alinhado (mesma fórmula, mesmos números):** "Total em Aberto" (dashboard), "Recebido no Mês" (dashboard), gráfico de 6 meses e painel "Recebido" usam todos `(paidAmount ?? value)` com `!creditPaid` para `paid/partial` → **batem entre si**. ✅

**Onde o mesmo valor é calculado de formas diferentes:**
- **Juros:** "Juros já pagos" (painel da dívida) inclui juros **pendentes** de `skipped/partial`; "Juros mensais/recebidos" (relatório) mostra **0** para os mesmos enquanto pendentes. Mesmo número, dois significados → convergem só quando a cadeia é quitada.
- **Total da dívida:** o card "Total da Dívida" sempre mostra o `total` **original**; os valores das parcelas crescem com juros. Logo `Pago + Aberto` pode **exceder** o "Total" sem reconciliação visível.
- **Juros por parcela:** três implementações independentes (rotas inline, `financialLogic.mjs`, `page.js`) — risco de divergência futura; os testes validam apenas a versão pura, que **não roda em produção**.
- **Taxa padrão:** modelo/formulário usam 10%; scheduler/mensagem usam fallback `|| 2` → uma dívida com `interestRate = 0` é cobrada a **2%** pelo motor automático e a **0%** pelo manual.

---

## ETAPA 3 — Simulação de cenários (parcela R$100, juros 10% quando aplicável)

| Cenário | Esperado | Resultado no sistema | Veredito |
|---|---|---|---|
| **Integral** (paga 100) | Parcela quitada, recebido +100 | `paid`, recebido 100, sem carry | ✅ Correto |
| **Parcial** (paga 40, sem juros) | Saldo 60 vai p/ próxima | Próxima `+60` | ✅ Correto |
| **Parcial c/ juros** (paga 40, 10%) | Saldo 60 + juros 6 = 66 p/ próxima | Próxima `value += 66`, `carriedInterest 6`; parcela fica `partial` mantendo 100 | ✅ Cálculo correto / 🟡 exibição |
| **Não pagou** (0, sem juros) | 100 transferido | Próxima `+100`, atual `skipped` | ✅ Correto (com ressalvas) |
| **Não pagou c/ juros** (0, 10%) | 100 + 10 = 110 p/ próxima | Próxima `+110`, `carriedInterest 10` | ✅ Cálculo correto |
| **3 atrasos consecutivos** (skip×3) | Saldo e juros acumulam corretamente | P1→110; P2(210) skip→ carry 231, P3=331; P3 skip→ carry 364,10 **perdido** (sem próxima) e dívida vira "Quitado" | 🔴 Quebra na 3ª/última |
| **Última parcela — integral** | Quitada | `paid`, recebido correto | ✅ Correto |
| **Última parcela — parcial** | Saldo deveria permanecer devido | Carry **descartado**, dívida marcada `paid` | 🔴 Perde dinheiro |
| **Última parcela — não pagou** | Saldo deveria permanecer devido | Carry **descartado**, dívida marcada `paid` | 🔴 Perde dinheiro |

**Integridade da cadeia quando RESOLVIDA:** se uma sequência de skip/parcial termina num pagamento integral, a varredura para trás reproduz exatamente os juros acumulados e `jurosJaPagos` bate com o juros recebido. A matemática é **correta enquanto há uma próxima parcela para absorver o saldo**. O problema é estrutural nas **bordas** (última parcela) e na **edição** (ver abaixo).

---

## ETAPA 4 — Usabilidade durante operações financeiras

- **"O usuário entende o que aconteceu?"** No pagamento parcial, sim (há preview). No "Não Pagou", parcialmente: a confirmação mostra o valor transferido, mas depois a lista não deixa explícito que **a dívida total cresceu** e que aquele valor agora vive na próxima parcela.
- **"Os valores fazem sentido?"** Em geral sim, exceto: "Juros já pagos" some valores **não recebidos**; "Total da Dívida" não acompanha os juros; `Pago + Aberto` pode passar do "Total".
- **"Risco de interpretação errada?"** Alto em dois pontos: (1) o rótulo "Juros já pagos" sugere arrecadação que pode não ter ocorrido; (2) parcela `skipped` aparece como "Não Pagou" mesmo quando seu valor **foi efetivamente recebido depois** via a próxima parcela.
- **"Deixa claro o que foi pago / pendente / transferido / juros?"** Pago e pendente: razoável (linha da parcela + barra de progresso). Transferido: só no momento da ação (some da visão depois). Juros: confuso pelo rótulo e por não haver um "valor atualizado da dívida".

---

# RELATÓRIO FINAL

## 🔴 Bugs Críticos — podem gerar valores incorretos

1. **Saldo perdido na última parcela.** Skip ou pagamento parcial na última parcela em aberto: como não há "próxima", o `carry` (saldo + juros) **não é transferido a lugar nenhum** e a dívida ainda é marcada como `paid`. Dinheiro devido desaparece. (`pay/[idx]` e `skip/[idx]`)
2. **`skipped` conta como quitação.** `allSettled` trata `skipped` como liquidado; uma dívida com parcelas "Não Pagou" pode virar `status: 'paid'`, e o "Total em Aberto" deixa de contar o devido.
3. **Editar uma dívida zera os saldos acumulados.** Na edição (`debts/[id]` PUT) a comparação de data está quebrada (`String(Date).slice(0,10)` nunca igual a `'YYYY-MM-DD'`), então **toda edição regenera as parcelas**; a regeneração restaura status/`paidAmount` mas **não** restaura `value`, `carriedInterest` nem `isPenalty`. Resultado: qualquer edição numa dívida com skips/parciais **apaga o saldo e os juros transferidos** e zera as parcelas inflada de volta ao valor base.
4. **Pagamento "0" é registrado como pagamento integral.** O front envia `parseFloat(payAmount) || null`; digitar `0` vira `null`, e o backend trata `null` como pagamento **integral** (`payAmount = dueValue`). Em vez de registrar não pagamento, quita a parcela.
5. **Juros aplicados a dívidas de 0%.** O scheduler e a mensagem de atraso usam `debt.interestRate || 2`. Uma dívida com `interestRate = 0` recebe **2%** automaticamente — divergindo do caminho manual (que respeita 0%).
6. **Soma das parcelas ≠ total.** `instValue = round(total/n, 2)` para todas (ex.: 100/3 = 33,33 ×3 = 99,99). A dívida não fecha com a soma das parcelas; nenhuma absorve o resíduo.
7. **"Juros já pagos" infla quando juros automático e skip se sobrepõem.** Se uma parcela teve penalidade do scheduler (`penaltyApplied`, `value−originalValue`) **e** depois recebeu carry de um skip (que aumenta `value` com principal+juros de outra parcela), o cálculo `value − originalValue` passa a **contar principal transferido como juros**, superestimando os juros relatados.

## 🟠 Inconsistências — valores certos, exibição/significado divergentes

1. **Dois significados para "juros".** "Juros já pagos" (painel) inclui juros **pendentes** (skip/partial não resolvidos); o relatório "Recebido/Juros mensais" mostra **0** para os mesmos. O rótulo "já pagos" não corresponde ao que o número representa (juros *incidentes*).
2. **"Total da Dívida" estático.** Mostra sempre o principal original; como as parcelas crescem com juros, `Pago + Aberto` pode exceder o "Total" sem explicação.
3. **Crédito de pagamento a maior.** Parcela quitada por crédito mostra "Pago R$X" na linha, mas **não** entra no "Pago" total do painel (`creditPaid`) — a soma das linhas não fecha com o agregado.
4. **Parcela `skipped` rotulada "Não Pagou" mesmo após arrecadação.** Quando o saldo transferido é pago via a próxima parcela, a original continua exibida como "Não Pagou", embora o dinheiro tenha entrado.
5. **Parcelas pré-pagas distorcem o mês.** `paidInstallments` grava `paidDate = data de vencimento` e **sem** `paidAmount` (usa `value`); se o vencimento cair no mês corrente, infla o "Recebido no Mês" com caixa que não ocorreu.
6. **Lógica financeira triplicada.** Rotas, `financialLogic.mjs` e `page.js` reimplementam o mesmo cálculo; os testes cobrem apenas a versão que não roda em produção.

## 🟡 Problemas de Usabilidade — risco de interpretação errada

1. **Rótulo "Juros já pagos"** sugere arrecadação para juros que ainda estão pendentes na próxima parcela.
2. **Skip não comunica o crescimento da dívida.** Falta deixar explícito que o valor foi para a próxima parcela e que o saldo total aumentou.
3. **Sem "valor atual da dívida".** Só o total original é exibido; o operador não enxerga principal + juros acumulados num único número.
4. **Mensagem de sucesso falsa.** "Cliente Finalizado / Quitado" pode aparecer mesmo quando houve perda de saldo na última parcela (bug crítico 1).
5. **Capitalização (juros sobre juros) não explicada.** Em atrasos consecutivos a parcela cresce muito; nada na tela explica o porquê.
6. **Pagamento parcial visualmente ambíguo depois de confirmado.** A parcela continua mostrando o valor original (100) com "saldo transferido"; entender que a dívida real agora está na próxima parcela (166) exige interpretação.

## ✅ Fluxos Corretos

1. **Pagamento integral** — quitação, `paidAmount` e "Recebido" corretos, sem efeitos colaterais.
2. **Cadeia de skip/parcial que termina em pagamento integral** — a varredura para trás reproduz os juros acumulados; `jurosJaPagos` bate com o juros recebido (consistência matemática real ao resolver).
3. **Pagamento a maior** — crédito propagado **sem juros** e `creditPaid` evitando dupla contagem no "Recebido".
4. **Coerência entre dashboard, gráfico e painel "Recebido"** — todos usam a mesma fórmula e batem entre si.
5. **Tolerância de 1 centavo** na classificação parcial/integral evita falsos parciais por arredondamento.
6. **Preview do pagamento parcial** — exibe saldo, juros e total transferido antes de confirmar: boa transparência no momento da ação.

---

## TOP 10 PRIORIDADES — para um sistema matematicamente confiável e intuitivo

1. **Não perder saldo na última parcela.** Quando não houver próxima parcela, criar uma parcela de rolagem (ou manter o saldo em aberto) e **não** marcar a dívida como quitada com saldo > 0. *(Bug 1)*
2. **Parar de tratar `skipped` como quitado.** Considerar quitação apenas quando o saldo real for zero. *(Bug 2)*
3. **Preservar os saldos ao editar.** Corrigir a comparação de data e/ou só regenerar quando o cronograma realmente mudar; ao regenerar, restaurar `value`, `carriedInterest` e `isPenalty`. *(Bug 3)*
4. **Tratar "0" como não pagamento, não como integral.** Distinguir explicitamente valor zero de campo vazio no fluxo de pagamento. *(Bug 4)*
5. **Unificar a taxa de juros e respeitar 0%.** Eliminar o fallback `|| 2`; usar uma única fonte de taxa para scheduler, skip e parcial. *(Bug 5)*
6. **Fechar a soma das parcelas com o total.** Distribuir o resíduo de arredondamento (ex.: na última parcela). *(Bug 6)*
7. **Unificar os dois modelos de "atraso/juros".** Definir uma única regra de negócio (inflar a parcela e rolar, OU transferir para a próxima) e aplicá-la em ambos os caminhos; documentar se há ou não capitalização. *(Bug 7 / Inconsistência 6)*
8. **Renomear/redefinir "Juros já pagos".** Separar claramente "juros recebidos" de "juros acumulados/pendentes" para que o número corresponda ao rótulo. *(Inconsistência 1 / Usabilidade 1)*
9. **Exibir o valor atualizado da dívida.** Mostrar principal + juros acumulados e reconciliar `Pago + Aberto` com o total, evitando que a soma "estoure" sem explicação. *(Inconsistência 2 / Usabilidade 3)*
10. **Cobrir o código de produção com testes de cenário.** Testar as rotas reais (pay/skip/edição/última parcela) e consolidar a lógica financeira numa única fonte importada por todas as telas. *(Inconsistência 6)*
