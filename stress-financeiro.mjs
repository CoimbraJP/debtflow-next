/**
 * HARNESS DE ESTRESSE — Lógica financeira do DebtFlow
 * Porta fiel das funções de produção (pay / skip / scheduler / create / edit)
 * e dos calculadores de cada "janela" do page.js.
 * Não toca no projeto. Apenas simula e confere.
 */

const r2 = x => parseFloat((x).toFixed(2));
const C  = v => Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

// ───────────────────────────────────────────────────────────────────────────
// PORT: criação de parcelas (app/api/debts/route.js)
// ───────────────────────────────────────────────────────────────────────────
function genCreate({ total, installments, dueDay, startDate, paidCount = 0 }) {
  const list = [];
  const instValue = r2(total / installments);
  const base = new Date(startDate + 'T00:00:00Z');
  const startDay = base.getUTCDate();
  const firstDue = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), dueDay));
  if (firstDue.getUTCDate() !== dueDay) firstDue.setUTCDate(0);
  if (dueDay <= startDay) { firstDue.setUTCMonth(firstDue.getUTCMonth()+1); firstDue.setUTCDate(dueDay); if (firstDue.getUTCDate()!==dueDay) firstDue.setUTCDate(0); }
  for (let i=0;i<installments;i++){
    const d=new Date(firstDue); d.setUTCMonth(firstDue.getUTCMonth()+i); d.setUTCDate(dueDay); if(d.getUTCDate()!==dueDay) d.setUTCDate(0);
    const dueStr=d.toISOString().slice(0,10); const ap=i<paidCount;
    list.push({ number:i+1, value:instValue, originalValue:instValue, dueDate:dueStr,
      status:ap?'paid':'pending', isPenalty:false, penaltyRate:0, penaltyApplied:ap,
      dueSent:ap, overdueSent:ap, paidDate:ap?dueStr:null, paidAmount:null, carriedInterest:0, creditPaid:false });
  }
  return list;
}
function makeDebt(opts){
  const d={ name:opts.name||'Cliente', product:opts.product||'Produto',
    total:opts.total, installments:opts.installments, dueDay:opts.dueDay,
    interestRate:opts.interestRate, createdAtStr:opts.startDate,
    status:'pending', installmentList:[] };
  d.installmentList=genCreate(opts);
  d.status = (opts.paidCount||0)>=opts.installments ? 'paid' : 'pending';
  return d;
}

// Ledger independente p/ checar conservação de dinheiro (não usa a lógica do app)
const ledger = new WeakMap();
function L(debt){ if(!ledger.has(debt)) ledger.set(debt,{interestCharged:0}); return ledger.get(debt); }

// ───────────────────────────────────────────────────────────────────────────
// PORT: pagamento (app/api/debts/[id]/pay/[idx]/route.js)
// payAmountInput: o que o FRONT envia => parseFloat(payAmount)||null  (0 vira null!)
// ───────────────────────────────────────────────────────────────────────────
function pay(debt, i, payAmountFront /* já no formato do front: número ou null */, payDate){
  const inst=debt.installmentList[i];
  const dueValue=parseFloat(inst.value)||0;
  const payAmount = (payAmountFront && payAmountFront>0) ? parseFloat(payAmountFront) : dueValue;
  const isPartial = payAmount < dueValue - 0.009;
  const isOver    = payAmount > dueValue + 0.009;
  inst.status = isPartial?'partial':'paid'; inst.paidDate=payDate; inst.paidAmount=payAmount; inst.creditPaid=false;
  if(isPartial){
    const remainder=r2(dueValue-payAmount);
    const rate=parseFloat(debt.interestRate)||0;
    const interestPart=r2(remainder*rate/100);
    const carry=r2(remainder+interestPart);
    inst.dueSent=true; inst.overdueSent=true; inst.penaltyApplied=true;
    const totalInterestToCarry=r2(interestPart+(inst.carriedInterest||0));
    const nextInst=debt.installmentList.find((p,j)=>j>i && !['paid','partial','skipped'].includes(p.status));
    if(nextInst){ nextInst.value=r2(parseFloat(nextInst.value)+carry); nextInst.isPenalty=true; nextInst.carriedInterest=r2((nextInst.carriedInterest||0)+totalInterestToCarry); }
    L(debt).interestCharged=r2(L(debt).interestCharged+interestPart);
    L(debt).lostCarry = (L(debt).lostCarry||0) + (nextInst?0:remainder); // saldo perdido se não houve próxima
  } else if(isOver){
    let credit=r2(payAmount-dueValue);
    for(let j=i+1;j<debt.installmentList.length && credit>0.009;j++){
      const next=debt.installmentList[j];
      if(['paid','partial','skipped'].includes(next.status)) continue;
      const nextVal=parseFloat(next.value)||0;
      if(credit>=nextVal-0.009){ next.status='paid'; next.paidDate=payDate; next.paidAmount=nextVal; next.creditPaid=true; next.dueSent=true; next.overdueSent=true; next.penaltyApplied=true; credit=r2(credit-nextVal); }
      else { next.value=r2(nextVal-credit); credit=0; }
    }
  }
  recalcStatus(debt);
}

// ───────────────────────────────────────────────────────────────────────────
// PORT: "Não Pagou" (app/api/debts/[id]/skip/[idx]/route.js)
// ───────────────────────────────────────────────────────────────────────────
function skip(debt, i){
  const inst=debt.installmentList[i];
  const instValue=parseFloat(inst.value)||0;
  const rate=parseFloat(debt.interestRate)||0;
  const interest=r2(instValue*rate/100);
  const carry=r2(instValue+interest);
  const totalInterestToCarry=r2(interest+(inst.carriedInterest||0));
  inst.status='skipped'; inst.penaltyApplied=true; inst.dueSent=true; inst.overdueSent=true;
  const nextInst=debt.installmentList.find((p,j)=>j>i && !['paid','partial','skipped'].includes(p.status));
  if(nextInst){ nextInst.value=r2(parseFloat(nextInst.value)+carry); nextInst.isPenalty=true; nextInst.carriedInterest=r2((nextInst.carriedInterest||0)+totalInterestToCarry); }
  L(debt).interestCharged=r2(L(debt).interestCharged+interest);
  L(debt).lostCarry = (L(debt).lostCarry||0) + (nextInst?0:instValue); // principal perdido se não houve próxima
  recalcStatus(debt);
}

// ───────────────────────────────────────────────────────────────────────────
// PORT: scheduler — juros de atraso 5+ dias (lib/scheduler.js)
// ───────────────────────────────────────────────────────────────────────────
function schedulerInterest(debt, instIdx){
  const inst=debt.installmentList[instIdx];
  if(['paid','partial','skipped'].includes(inst.status)) return;
  if(inst.penaltyApplied) return;
  const rate=(debt.interestRate||2)/100;          // <-- fallback ||2 da produção
  const oldVal=inst.value;
  const newVal=r2(inst.value*(1+rate));
  inst.value=newVal; inst.isPenalty=true; inst.penaltyRate=debt.interestRate||2;
  inst.penaltyApplied=true; inst.dueSent=false; inst.overdueSent=false; inst.status='pending';
  L(debt).interestCharged=r2(L(debt).interestCharged+(newVal-oldVal));
  recalcStatus(debt);
}

// ───────────────────────────────────────────────────────────────────────────
// PORT: edição/regeneração (app/api/debts/[id]/route.js PUT)
// Emula createdAt como Date (Mongoose) => comparação de data sempre falha => regen sempre
// ───────────────────────────────────────────────────────────────────────────
function editDebt(debt, fields){
  // No servidor real, debt.createdAt é um objeto Date. String(Date).slice(0,10) != 'YYYY-MM-DD'
  const dbCreatedAt = String(new Date(debt.createdAtStr+'T00:00:00Z')).slice(0,10); // "Thu Jun 18"
  const total=fields.total??debt.total, installments=fields.installments??debt.installments,
        dueDay=fields.dueDay??debt.dueDay, startDate=fields.startDate??debt.createdAtStr;
  const needsRegen = debt.total!==parseFloat(total) || debt.installments!==parseInt(installments)
      || debt.dueDay!==parseInt(dueDay) || dbCreatedAt!==(startDate||'').slice(0,10);
  const paidByNum={};
  if(needsRegen){ debt.installmentList.forEach(inst=>{ if(['paid','partial','skipped'].includes(inst.status)) paidByNum[inst.number]={status:inst.status,paidDate:inst.paidDate,paidAmount:inst.paidAmount}; }); }
  if(fields.notes!==undefined) debt.notes=fields.notes;
  debt.total=parseFloat(total); debt.installments=parseInt(installments); debt.dueDay=parseInt(dueDay);
  if(fields.interestRate!==undefined) debt.interestRate=parseFloat(fields.interestRate)||10;
  debt.createdAtStr=startDate;
  if(needsRegen){
    const newList=genCreate({total:debt.total,installments:debt.installments,dueDay:debt.dueDay,startDate});
    newList.forEach(inst=>{ if(paidByNum[inst.number]){ const p=paidByNum[inst.number]; inst.status=p.status; inst.paidDate=p.paidDate; inst.paidAmount=p.paidAmount||null; inst.penaltyApplied=true; inst.dueSent=true; inst.overdueSent=true; } });
    debt.installmentList=newList;
  }
  recalcStatus(debt);
  return needsRegen;
}

function recalcStatus(debt){
  const all=debt.installmentList.every(p=>['paid','partial','skipped'].includes(p.status));
  const over=debt.installmentList.some(p=>p.status==='overdue'||p.status==='skipped');
  debt.status= all?'paid':over?'overdue':'pending';
}

// ═══════════════════════════════════════════════════════════════════════════
// JANELAS (port fiel de app/page.js)
// ═══════════════════════════════════════════════════════════════════════════
const daysDiff=(a,b)=>Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);

// Dashboard KPIs
function winDashboard(debts, today){
  const month=today.slice(0,7); let totalOpen=0,received=0,overdueCount=0,upcomingCount=0;
  debts.forEach(d=>d.installmentList.forEach(i=>{
    if(i.status==='paid'||i.status==='partial'){ if(i.paidDate&&i.paidDate.startsWith(month)&&!i.creditPaid) received+=(i.paidAmount??i.value); }
    else if(i.status==='skipped'){}
    else { totalOpen+=i.value; const diff=daysDiff(today,i.dueDate); if(diff<0)overdueCount++; if(diff>=0&&diff<=5)upcomingCount++; }
  }));
  return { totalOpen:r2(totalOpen), received:r2(received), overdueCount, upcomingCount };
}
// Lista de dívidas (tabela/cards) — contagem de "pagas"
function winDebtList(debt){
  const paid=debt.installmentList.filter(i=>i.status==='paid').length;      // SÓ 'paid'
  const total=debt.installmentList.length;
  return { paidCount:paid, total, progress: total>0?Math.round(paid/total*100):0 };
}
// Painel da dívida (DebtPanel)
function winDebtPanel(debt){
  const rate=parseFloat(debt.interestRate)||0;
  const paidCount=debt.installmentList.filter(i=>['paid','partial','skipped'].includes(i.status)).length; // paid+partial+skipped
  const total=debt.installmentList.length;
  const pago=r2(debt.installmentList.filter(i=>(i.status==='paid'||i.status==='partial')&&!i.creditPaid).reduce((s,i)=>s+(i.paidAmount??i.value),0));
  const aberto=r2(debt.installmentList.filter(i=>!['paid','partial','skipped'].includes(i.status)).reduce((s,i)=>s+i.value,0));
  let jjp=0;
  debt.installmentList.forEach(inst=>{
    if(inst.status==='skipped') jjp+=r2((inst.value||0)*rate/100);
    else if(inst.status==='partial'){ const saldo=Math.max(0,(inst.value||0)-(inst.paidAmount||0)); jjp+=r2(saldo*rate/100); }
    else if(inst.status==='paid'&&inst.penaltyApplied&&inst.penaltyRate>0) jjp+=Math.max(0,(inst.value||0)-(inst.originalValue||0));
  });
  return { paidCount, total, progress: total>0?Math.round(paidCount/total*100):0, pago, aberto, jurosJaPagos:r2(jjp) };
}
// Relatório "Recebido no mês" (KPI panel) — juros via backward-scan
function winKpiReceived(debt, today){
  const month=today.slice(0,7); const rate=parseFloat(debt.interestRate)||0;
  let received=0, juros=0; const list=debt.installmentList;
  list.forEach((inst,iIdx)=>{
    if(!['paid','partial'].includes(inst.status)) return;
    if(!inst.paidDate||!inst.paidDate.startsWith(month)) return;
    if(inst.creditPaid) return;
    received+=(inst.paidAmount??inst.value);
    let j=0;
    if(inst.status==='partial') j=0;
    else if(inst.status==='paid'){
      if(inst.penaltyApplied&&inst.penaltyRate>0) j=Math.max(0,(inst.value||0)-(inst.originalValue||0));
      else if(inst.isPenalty){ for(let k=iIdx-1;k>=0;k--){ const prev=list[k]; if(prev.status==='skipped') j=r2(j+(prev.value||0)*rate/100); else if(prev.status==='partial'){ const s=Math.max(0,(prev.value||0)-(prev.paidAmount||0)); j=r2(j+s*rate/100); break;} else break; } }
    }
    juros=r2(juros+j);
  });
  return { received:r2(received), juros:r2(juros) };
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAÇÃO
// ═══════════════════════════════════════════════════════════════════════════
let PASS=0, FAIL=0; const problems=[];
function check(cond, label, detail){ if(cond){PASS++;} else {FAIL++; problems.push(`✗ ${label} ${detail||''}`);} }
const approxEq=(a,b,t=0.005)=>Math.abs(a-b)<=t;

// INVARIANTE A — conservação de dinheiro dentro da dívida:
//   caixa recebido + saldo em aberto  ==  principal agendado + juros cobrados
function invariantConservation(debt, label){
  const caixa=r2(debt.installmentList.filter(i=>(i.status==='paid'||i.status==='partial')&&!i.creditPaid).reduce((s,i)=>s+(i.paidAmount??i.value),0));
  const aberto=r2(debt.installmentList.filter(i=>!['paid','partial','skipped'].includes(i.status)).reduce((s,i)=>s+i.value,0));
  const principalAgendado=r2(debt.installmentList.reduce((s,i)=>s+(i.originalValue||0),0));
  const jurosCobrados=L(debt).interestCharged||0;
  const esperado=r2(principalAgendado+jurosCobrados);
  const obtido=r2(caixa+aberto);
  const ok=approxEq(obtido,esperado,0.02);
  check(ok, `[${label}] CONSERVAÇÃO`, `obtido(caixa ${C(caixa)} + aberto ${C(aberto)} = ${C(obtido)}) vs esperado(principal ${C(principalAgendado)} + juros ${C(jurosCobrados)} = ${C(esperado)})`);
  return {caixa,aberto,principalAgendado,jurosCobrados,esperado,obtido,lostCarry:L(debt).lostCarry||0};
}

// CONSISTÊNCIA ENTRE JANELAS (mesmo cliente)
function invariantWindows(debt, today, label){
  const dash=winDashboard([debt], today);
  const list=winDebtList(debt);
  const panel=winDebtPanel(debt);
  const kpi=winKpiReceived(debt, today);
  // 1) "aberto" do painel == totalOpen do dashboard
  check(approxEq(panel.aberto, dash.totalOpen), `[${label}] aberto(painel)==totalOpen(dash)`, `${C(panel.aberto)} vs ${C(dash.totalOpen)}`);
  // 2) recebido no mês: dashboard == kpi painel
  check(approxEq(dash.received, kpi.received), `[${label}] recebido(dash)==recebido(kpi)`, `${C(dash.received)} vs ${C(kpi.received)}`);
  // 3) contagem de parcelas pagas: LISTA vs PAINEL  (devem ser iguais p/ mesmo cliente)
  check(list.paidCount===panel.paidCount, `[${label}] pagas: lista==painel`, `lista ${list.paidCount}/${list.total} vs painel ${panel.paidCount}/${panel.total}`);
  // 4) "Juros já pagos" (painel) deve refletir juros RECEBIDOS, não pendentes
  //    juros recebidos reais = soma kpi juros (parcelas pagas). Se jjp > recebido => rótulo enganoso.
  const jurosRecebidos = kpi.juros;
  check(approxEq(panel.jurosJaPagos, jurosRecebidos), `[${label}] jurosJaPagos==jurosRecebidos`, `painel "já pagos" ${C(panel.jurosJaPagos)} vs realmente recebido ${C(jurosRecebidos)}`);
  return {dash,list,panel,kpi};
}

function header(t){ console.log('\n'+'═'.repeat(78)+'\n'+t+'\n'+'═'.repeat(78)); }

// ───────────────────────────────────────────────────────────────────────────
// CENÁRIOS
// ───────────────────────────────────────────────────────────────────────────
const TODAY='2026-06-18';

header('CENÁRIO 1 — Pagamento integral (3×100, paga parcela 1 cheia)');
{
  const d=makeDebt({name:'C1',total:300,installments:3,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(d,0,100,'2026-06-18');
  console.log('parcelas:',d.installmentList.map(i=>`${i.number}:${i.status} R$${C(i.value)} pago=${i.paidAmount??'-'}`).join(' | '));
  invariantConservation(d,'C1'); invariantWindows(d,TODAY,'C1');
}

header('CENÁRIO 2 — Pagamento parcial (parcela 100, paga 40, sem juros)');
{
  const d=makeDebt({name:'C2',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:0});
  pay(d,0,40,'2026-06-18');
  console.log('parcelas:',d.installmentList.map(i=>`${i.number}:${i.status} R$${C(i.value)} pago=${i.paidAmount??'-'}`).join(' | '));
  invariantConservation(d,'C2'); invariantWindows(d,TODAY,'C2');
}

header('CENÁRIO 3 — Parcial com juros (100, paga 40, juros 10%) — saldo 60 + 6 = 66 p/ próxima');
{
  const d=makeDebt({name:'C3',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(d,0,40,'2026-06-18');
  console.log('P1:',d.installmentList[0].status,'pago',C(d.installmentList[0].paidAmount),'| P2 value=',C(d.installmentList[1].value),'(esperado 166,00)');
  invariantConservation(d,'C3'); invariantWindows(d,TODAY,'C3');
}

header('CENÁRIO 4 — Não pagamento (0, sem juros) via botão "Não Pagou"');
{
  const d=makeDebt({name:'C4',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:0});
  skip(d,0);
  console.log('P1:',d.installmentList[0].status,'| P2 value=',C(d.installmentList[1].value),'(esperado 200,00)');
  invariantConservation(d,'C4'); invariantWindows(d,TODAY,'C4');
}

header('CENÁRIO 4b — Usuário digita "0" no modal de PAGAMENTO (front manda null)');
{
  const d=makeDebt({name:'C4b',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(d,0, (parseFloat('0')||null), '2026-06-18');   // exatamente o que o front faz
  console.log('P1 status:',d.installmentList[0].status,'pago=',C(d.installmentList[0].paidAmount),'(usuário quis registrar NÃO pagamento de R$0)');
  check(d.installmentList[0].status!=='paid', '[C4b] "0" NÃO deveria virar pagamento integral', `virou status=${d.installmentList[0].status}`);
}

header('CENÁRIO 5 — Não pagamento com juros (100, 10%)');
{
  const d=makeDebt({name:'C5',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:10});
  skip(d,0);
  console.log('P1:',d.installmentList[0].status,'| P2 value=',C(d.installmentList[1].value),'(esperado 210,00)');
  invariantConservation(d,'C5'); invariantWindows(d,TODAY,'C5');
}

header('CENÁRIO 6 — 3 atrasos consecutivos (4×100, juros 10%) — skip P1,P2,P3, paga P4');
{
  const d=makeDebt({name:'C6',total:400,installments:4,dueDay:10,startDate:'2026-06-01',interestRate:10});
  skip(d,0); console.log('após skip P1 -> P2 value=',C(d.installmentList[1].value));
  skip(d,1); console.log('após skip P2 -> P3 value=',C(d.installmentList[2].value));
  skip(d,2); console.log('após skip P3 -> P4 value=',C(d.installmentList[3].value),'(P4 acumula tudo)');
  pay(d,3,d.installmentList[3].value,'2026-06-18');
  console.log('P4 status:',d.installmentList[3].status);
  invariantConservation(d,'C6'); invariantWindows(d,TODAY,'C6');
}

header('CENÁRIO 7 — ÚLTIMA parcela: pagamento integral / parcial / não pagou');
{
  // 7a integral
  const a=makeDebt({name:'C7a',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(a,0,100,'2026-06-18'); pay(a,1,100,'2026-06-18');
  console.log('7a integral -> status:',a.status); invariantConservation(a,'C7a-integral');
  // 7b parcial na última
  const b=makeDebt({name:'C7b',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(b,0,100,'2026-06-18'); pay(b,1,40,'2026-06-18');
  console.log('7b parcial última -> status:',b.status,'| caixa+aberto deveria conter o saldo 60+juros');
  const ib=invariantConservation(b,'C7b-parcial-ultima'); console.log('   saldo perdido (lostCarry):',C(ib.lostCarry));
  check(b.status!=='paid', '[C7b] dívida com saldo NÃO pode estar quitada', `status=${b.status}`);
  // 7c não pagou na última
  const c=makeDebt({name:'C7c',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(c,0,100,'2026-06-18'); skip(c,1);
  console.log('7c não pagou última -> status:',c.status);
  const ic=invariantConservation(c,'C7c-skip-ultima'); console.log('   principal perdido (lostCarry):',C(ic.lostCarry));
  check(c.status!=='paid', '[C7c] dívida com não-pagamento NÃO pode estar quitada', `status=${c.status}`);
}

header('CENÁRIO 8 — Edição inócua (muda só "notes") numa dívida com skip — saldos devem ser preservados');
{
  const d=makeDebt({name:'C8',total:400,installments:4,dueDay:10,startDate:'2026-06-01',interestRate:10});
  skip(d,0);
  const p2antes=d.installmentList[1].value;
  console.log('antes da edição: P2 value=',C(p2antes),'(deve estar 210,00 com o carry)');
  const regen=editDebt(d,{ notes:'só uma observação' });   // não muda total/parcelas/dia/início
  const p2depois=d.installmentList[1].value;
  console.log('regenerou parcelas?',regen,'| P2 value depois=',C(p2depois));
  check(!regen, '[C8] editar só "notes" NÃO deveria regenerar parcelas', `regen=${regen}`);
  check(approxEq(p2antes,p2depois), '[C8] carry de P2 deve ser preservado após edição', `${C(p2antes)} -> ${C(p2depois)}`);
}

header('CENÁRIO 9 — Arredondamento: total 100 em 3 parcelas');
{
  const d=makeDebt({name:'C9',total:100,installments:3,dueDay:10,startDate:'2026-06-01',interestRate:10});
  const soma=r2(d.installmentList.reduce((s,i)=>s+i.value,0));
  console.log('parcelas:',d.installmentList.map(i=>C(i.value)).join(' + '),'=',C(soma),'| total=',C(d.total));
  check(approxEq(soma,d.total,0.005), '[C9] soma das parcelas == total', `${C(soma)} vs ${C(d.total)}`);
}

header('CENÁRIO 10 — Juros automático (scheduler) numa dívida de 0% de juros');
{
  const d=makeDebt({name:'C10',total:200,installments:2,dueDay:10,startDate:'2026-01-01',interestRate:0});
  const antes=d.installmentList[0].value;
  schedulerInterest(d,0);   // parcela vencida 5+ dias, dívida 0%
  console.log('P1 value: antes',C(antes),'-> depois',C(d.installmentList[0].value),'(dívida é 0% de juros!)');
  check(approxEq(d.installmentList[0].value,antes), '[C10] dívida 0% não pode ganhar juros do scheduler', `${C(antes)} -> ${C(d.installmentList[0].value)}`);
}

header('CENÁRIO 11 — Cross-window: cliente com 1 paga, 1 parcial, 1 skip, 1 pendente');
{
  const d=makeDebt({name:'C11',total:400,installments:4,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(d,0,100,'2026-06-18');      // P1 paga
  pay(d,1,40,'2026-06-18');       // P2 parcial -> carry p/ P3
  skip(d,2);                      // P3 não pagou -> carry p/ P4
  const list=winDebtList(d), panel=winDebtPanel(d);
  console.log('LISTA diz pagas:',`${list.paidCount}/${list.total}`,'| PAINEL diz pagas:',`${panel.paidCount}/${panel.total}`);
  console.log('PAINEL "Juros já pagos":',C(panel.jurosJaPagos),'| Juros realmente recebido (kpi):',C(winKpiReceived(d,TODAY).juros));
  invariantWindows(d,TODAY,'C11');
  invariantConservation(d,'C11');
}


header('CENARIO 12 — Pagamento a MAIOR (4x100, paga 250 na P1) — credito sem juros');
{
  const d=makeDebt({name:'C12',total:400,installments:4,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(d,0,250,'2026-06-18');
  console.log('P1 pago=',C(d.installmentList[0].paidAmount),'creditPaid=',d.installmentList[0].creditPaid,
    '| P2',d.installmentList[1].status,'creditPaid=',d.installmentList[1].creditPaid,'val',C(d.installmentList[1].value),
    '| P3',d.installmentList[2].status,'val',C(d.installmentList[2].value));
  invariantConservation(d,'C12'); invariantWindows(d,TODAY,'C12');
}

header('CENARIO 13 — IDEMPOTENCIA: pagar a MESMA parcela duas vezes (duplo clique / retry)');
{
  const d=makeDebt({name:'C13',total:300,installments:3,dueDay:10,startDate:'2026-06-01',interestRate:10});
  pay(d,0,40,'2026-06-18');
  const p2_1=d.installmentList[1].value;
  pay(d,0,40,'2026-06-18');
  const p2_2=d.installmentList[1].value;
  console.log('P2 apos 1o parcial:',C(p2_1),'| apos repetir:',C(p2_2));
  check(approxEq(p2_1,p2_2), '[C13] repetir pagamento NAO pode reaplicar carry', `${C(p2_1)} -> ${C(p2_2)}`);
}

header('CENARIO 14 — Scheduler aplica juros e DEPOIS operador faz "Nao Pagou" na mesma parcela');
{
  const d=makeDebt({name:'C14',total:200,installments:2,dueDay:10,startDate:'2026-01-01',interestRate:10});
  schedulerInterest(d,0);
  skip(d,0);
  const panel=winDebtPanel(d);
  console.log('P2 value=',C(d.installmentList[1].value),'(esperado 100 + 121 = 221,00)');
  console.log('PAINEL jurosJaPagos=',C(panel.jurosJaPagos),'| juros real cobrado (ledger)=',C(L(d).interestCharged));
  invariantConservation(d,'C14');
}

header('CENARIO 15 — Cross-window AGREGADO: dashboard de 3 clientes == soma dos paineis');
{
  const a=makeDebt({name:'A',total:300,installments:3,dueDay:10,startDate:'2026-06-01',interestRate:10});
  const b=makeDebt({name:'B',total:200,installments:2,dueDay:10,startDate:'2026-06-01',interestRate:10});
  const cc=makeDebt({name:'C',total:500,installments:5,dueDay:10,startDate:'2026-06-01',interestRate:5});
  pay(a,0,100,'2026-06-18'); pay(b,0,80,'2026-06-18'); skip(cc,0); pay(cc,1,200,'2026-06-18');
  const debts=[a,b,cc];
  const dash=winDashboard(debts,TODAY);
  const somaPainelAberto=r2(debts.reduce((s,d)=>s+winDebtPanel(d).aberto,0));
  const somaKpiReceb=r2(debts.reduce((s,d)=>s+winKpiReceived(d,TODAY).received,0));
  console.log('dashboard totalOpen=',C(dash.totalOpen),'| soma paineis aberto=',C(somaPainelAberto));
  console.log('dashboard recebido=',C(dash.received),'| soma kpi recebido=',C(somaKpiReceb));
  check(approxEq(dash.totalOpen,somaPainelAberto), '[C15] totalOpen(dash)==soma aberto(paineis)', `${C(dash.totalOpen)} vs ${C(somaPainelAberto)}`);
  check(approxEq(dash.received,somaKpiReceb), '[C15] recebido(dash)==soma recebido(kpi)', `${C(dash.received)} vs ${C(somaKpiReceb)}`);
}

console.log('\n'+'-'.repeat(78));
console.log(`RESULTADO: ${PASS} checagens OK · ${FAIL} FALHAS`);
if(problems.length){ console.log('\nFALHAS DETECTADAS:'); problems.forEach(p=>console.log('  '+p)); }
console.log('-'.repeat(78));
