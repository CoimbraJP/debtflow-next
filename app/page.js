'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

// ── Constantes ────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#6C63FF','#00D4AA','#FF6B6B','#FFA502','#3D5AFE',
  '#FF4081','#00BCD4','#8BC34A','#FF7043','#AB47BC',
];
const DEFAULT_SETTINGS = {
  apiUrl: '', instance: '', apiKey: '', defaultInterest: 10,
  msgTemplate: 'Olá {nome}! 👋 Passando para lembrar que sua parcela *{parcela}/{total_parcelas}* referente a *{produto}* no valor de *R$ {valor}* vence em *{vencimento}*. Por favor, efetue o pagamento para evitar juros de atraso. Obrigado! 🙏',
  msgOverdue:  'Olá {nome}! Identificamos que a parcela {parcela}/{total_parcelas} referente a *{produto}* no valor de *R$ {valor}* está em *atraso* há {dias_atraso} dia(s). O novo valor com juros é *R$ {valor_com_juros}*. Entre em contato para regularizar sua situação. 😊',
};
const EMPTY_FORM = {
  name: '', phone: '', address: '', product: '', total: '', installments: '',
  dueDay: '', interestRate: 10, startDate: '', notes: '', paidInstallments: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────
function fmt(val) {
  return Number(val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function daysDiff(todayStr, dueStr) {
  const t = new Date(todayStr + 'T00:00:00');
  const d = new Date(dueStr   + 'T00:00:00');
  return Math.round((d - t) / 86400000);
}
function avatarColor(name) {
  let s = 0; for (const c of name) s += c.charCodeAt(0);
  return AVATAR_COLORS[s % AVATAR_COLORS.length];
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── WhatsApp helpers ──────────────────────────────────────────────────────
function buildMsg(template, debt, inst, extra = {}) {
  const wi = inst.value * (1 + (debt.interestRate || 2) / 100);
  return template
    .replace(/{nome}/g,            debt.name)
    .replace(/{produto}/g,         debt.product)
    .replace(/{valor}/g,           fmt(inst.value))
    .replace(/{valor_com_juros}/g, fmt(wi))
    .replace(/{vencimento}/g,      fmtDate(inst.dueDate))
    .replace(/{parcela}/g,         inst.number)
    .replace(/{total_parcelas}/g,  debt.installments)
    .replace(/{dias_atraso}/g,     extra.daysLate || 0);
}
async function sendViaAPI(phone, text, s) {
  const url = `${s.apiUrl.replace(/\/$/, '')}/message/sendText/${s.instance}`;
  const r   = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': s.apiKey },
    body: JSON.stringify({ number: String(phone).replace(/\D/g, ''), text }),
  });
  return r.ok;
}
function openWaMe(phone, text) {
  window.open(`https://wa.me/${String(phone).replace(/\D/g,'')}?text=${encodeURIComponent(text)}`, '_blank');
}

// ── Status badge ──────────────────────────────────────────────────────────
function StatusBadge({ debt, today }) {
  if (debt.status === 'paid') return <span className="badge muted"><span className="badge-dot"></span>Quitado</span>;
  const next = debt.installmentList?.find(i => !['paid','partial','skipped'].includes(i.status));
  if (!next) return <span className="badge muted"><span className="badge-dot"></span>Sem parcelas</span>;
  const diff = daysDiff(today, next.dueDate);
  if (diff < 0)  return <span className="badge danger"><span className="badge-dot"></span>{Math.abs(diff)}d atrasado</span>;
  if (diff === 0) return <span className="badge warning"><span className="badge-dot"></span>Vence hoje</span>;
  if (diff <= 5) return <span className="badge warning"><span className="badge-dot"></span>Em {diff}d</span>;
  return <span className="badge primary"><span className="badge-dot"></span>Em dia</span>;
}

// ═════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════
export default function App() {
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────
  const [debts,    setDebts]    = useState([]);
  const [activity, setActivity] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState('dashboard');
  const [filter,   setFilter]   = useState('all');
  const [search,   setSearch]   = useState('');
  const [sideDebt, setSideDebt] = useState(null); // debt object
  const [toasts,   setToasts]   = useState([]);
  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [adminName,   setAdminName]   = useState('Administrador');

  // Modal: nova/editar dívida
  const [debtModal,  setDebtModal]  = useState(false);
  const [debtForm,   setDebtForm]   = useState(EMPTY_FORM);
  const [editId,     setEditId]     = useState(null);

  // Modal: pagamento
  const [payModal,   setPayModal]   = useState(false);
  const [payInfo,    setPayInfo]    = useState({ debt: null, inst: null, idx: null, date: todayStr() });

  // Modal: excluir
  const [delModal,   setDelModal]   = useState(false);
  const [delDebt,    setDelDebt]    = useState(null);

  // Modal: confirmação genérica
  const [gcModal,    setGcModal]    = useState(false);
  const [gcData,     setGcData]     = useState({ title:'', msg:'', label:'', style:'danger', fn:null });

  // Settings form local
  const [settForm,   setSettForm]   = useState(DEFAULT_SETTINGS);

  // UX1: Button-level loading states
  const [btnLoading, setBtnLoading] = useState({});
  const [kpiPanel,   setKpiPanel]   = useState(null);
  const [payStep,    setPayStep]    = useState('enter'); // 'enter' | 'preview'
  const [sortOrder,  setSortOrder]  = useState('date');   // 'date' | 'alpha' // null | 'received' | 'overdue' | 'upcoming'
  // UX5: Form validation errors
  const [formErrors, setFormErrors] = useState({});

  const today = todayStr();

  // ── API helpers ──────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (r.status === 401) { router.push('/login'); return null; }
    return r;
  }

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [rd, ra, rs, rm] = await Promise.all([
      api('/api/debts'), api('/api/activity'), api('/api/settings'), api('/api/me'),
    ]);
    if (rd?.ok) setDebts(await rd.json());
    if (ra?.ok) setActivity(await ra.json());
    if (rs?.ok) {
      const s = await rs.json();
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setSettForm({ ...DEFAULT_SETTINGS, ...s });
    }
    if (rm?.ok) {
      const me = await rm.json();
      setAdminName(me.name);
    }
    setLoading(false);
  }, []); // eslint-disable-line

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Toast ───────────────────────────────────────────────────────────────
  function toast(msg, type = 'info', title = '') {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type, title }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }

  // ── Navigate ──────────────────────────────────────────────────────────
  const PAGE_META = {
    dashboard: { title: 'Dashboard',     subtitle: 'Visão geral do sistema' },
    debts:     { title: 'Dívidas',       subtitle: 'Gerenciar todas as dívidas' },
    calendar:  { title: 'Vencimentos',   subtitle: 'Calendário de cobranças' },
    activity:  { title: 'Atividade',     subtitle: 'Histórico de eventos' },
    settings:  { title: 'Configurações', subtitle: 'Preferências do sistema' },
  };
  function navigate(p) { setPage(p); setSidebarOpen(false); setMobileMenuOpen(false); }

  // ── CRUD Dívidas ───────────────────────────────────────────────────────
  // UX5: Validate debt form fields
  function validateDebtForm(f) {
    const errs = {};
    if (!f.name?.trim())                                            errs.name         = 'Nome obrigatório';
    if (!f.product?.trim())                                         errs.product      = 'Produto obrigatório';
    if (!f.total || parseFloat(f.total) <= 0)                       errs.total        = 'Valor deve ser maior que zero';
    if (!f.installments || parseInt(f.installments) < 1)            errs.installments = 'Mínimo 1 parcela';
    if (!f.dueDay || parseInt(f.dueDay) < 1 || parseInt(f.dueDay) > 28) errs.dueDay  = 'Entre 1 e 28';
    if (!f.startDate)                                               errs.startDate    = 'Data obrigatória';
  if (!f.phone?.trim())                                             errs.phone        = 'WhatsApp obrigatório';
    return errs;
  }

  function openNewDebt() {
    setEditId(null);
    setDebtForm({ ...EMPTY_FORM, startDate: today, interestRate: settings.defaultInterest || 10 });
    setFormErrors({});
    setDebtModal(true);
  }
  function openEditDebt(debt) {
    setEditId(debt.id);
    setDebtForm({
      name: debt.name, phone: debt.phone || '', address: debt.address || '',
      product: debt.product, total: debt.total, installments: debt.installments,
      dueDay: debt.dueDay, interestRate: debt.interestRate,
      startDate: debt.createdAt ? String(debt.createdAt).slice(0,10) : today, notes: debt.notes || '',
      paidInstallments: '',  // não preenchemos na edição
    });
    setFormErrors({});
    setDebtModal(true);
  }
  async function saveDebt() {
    const f = debtForm;
    const errs = validateDebtForm(f);
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      toast('Preencha todos os campos obrigatórios', 'danger', 'Campos inválidos');
      return;
    }
    setBtnLoading(b => ({...b, save: true}));
    try {
      const body = {
        ...f,
        total:            parseFloat(f.total),
        installments:     parseInt(f.installments),
        dueDay:           parseInt(f.dueDay),
        paidInstallments: parseInt(f.paidInstallments) || 0,
      };
      const r = editId
        ? await api(`/api/debts/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
        : await api('/api/debts', { method: 'POST', body: JSON.stringify(body) });
      if (!r) return;
      if (r.ok) {
        toast(editId ? `Dívida de ${f.name} atualizada!` : `Dívida de ${f.name} cadastrada!`, 'success', editId ? 'Atualizado' : 'Criado');
        setFormErrors({});
        setDebtModal(false);
        fetchAll();
      } else {
        try {
          const e = await r.json();
          toast(e.error || 'Erro ao salvar', 'danger', 'Erro');
        } catch {
          toast(`Erro ao salvar (${r.status})`, 'danger', 'Erro');
        }
      }
    } finally {
      setBtnLoading(b => ({...b, save: false}));
    }
  }
  async function deleteDebt(debt) {
    setBtnLoading(b => ({...b, delete: true}));
    try {
      const r = await api(`/api/debts/${debt.id}`, { method: 'DELETE' });
      if (r?.ok) {
        toast('Dívida removida com sucesso', 'success', 'Removido');
        setDelModal(false);
        setSideDebt(null);
        fetchAll();
      }
    } finally {
      setBtnLoading(b => ({...b, delete: false}));
    }
  }

  // ── Pagamentos ─────────────────────────────────────────────────────────
  function openPayModal(debt, inst, idx) {
    setPayStep('enter');
    setPayInfo({ debt, inst, idx, date: today, payAmount: inst?.value ?? '' });
    setPayModal(true);
  }
  function handlePaySubmit() {
    const dueValue = parseFloat(payInfo.inst?.value) || 0;
    const payAmt   = parseFloat(payInfo.payAmount)   || 0;
    if (payAmt > 0 && payAmt < dueValue - 0.009 && payStep === 'enter') {
      setPayStep('preview');
      return;
    }
    confirmPayment();
  }

  async function confirmPayment() {
    setBtnLoading(b => ({...b, pay: true}));
    try {
      const { debt, idx, date, payAmount } = payInfo;
      const r = await api(`/api/debts/${debt.id}/pay/${idx}`, { method: 'POST', body: JSON.stringify({ payDate: date, payAmount: parseFloat(payAmount) || null }) });
      if (r?.ok) {
        const updated = await r.json();
        toast(`Parcela ${payInfo.inst.number} de ${debt.name} registrada!`, 'success', 'Pagamento registrado');
        setPayModal(false);
        // Atualiza side panel se estiver aberto
        if (sideDebt?.id === debt.id) setSideDebt(updated);
        fetchAll();
      }
    } finally {
      setBtnLoading(b => ({...b, pay: false}));
    }
  }

  // ── WhatsApp ───────────────────────────────────────────────────────────
  async function sendWhatsApp(debt, inst, isOverdue = false) {
    if (!debt.phone) { toast('Sem número de WhatsApp', 'warning', 'Atenção'); return; }
    setBtnLoading(b => ({...b, whatsapp: debt.id}));
    try {
      const template = isOverdue ? settings.msgOverdue : settings.msgTemplate;
      const text = buildMsg(template, debt, inst);
      const hasApi = settings.apiUrl && settings.instance && settings.apiKey;
      if (hasApi) {
        toast('Enviando via API...', 'info', 'WhatsApp');
        const ok = await sendViaAPI(debt.phone, text, settings);
        if (ok) { toast(`Mensagem enviada para ${debt.name}!`, 'success', 'Enviado ✓'); return; }
      }
      openWaMe(debt.phone, text);
      toast('WhatsApp aberto! Clique em Enviar para confirmar.', 'success', 'WhatsApp pronto ✓');
    } finally {
      setBtnLoading(b => ({...b, whatsapp: false}));
    }
  }

  // ── Não Pagou ─────────────────────────────────────────────────────────
  async function skipPayment(debt, inst, idx) {
    try {
      const r = await api(`/api/debts/${debt.id}/skip/${idx}`, { method: 'POST' });
      if (r?.ok) {
        const updated = await r.json();
        toast(`Parcela ${inst.number} de ${debt.name}: não pagamento registrado.`, 'warning', '❌ Não Pagou');
        if (sideDebt?.id === debt.id) setSideDebt(updated);
        fetchAll();
      }
    } catch(e) {
      toast('Erro ao registrar não pagamento', 'danger', 'Erro');
    }
  }

  function confirmSkipPayment(debt, inst, idx) {
    const instValue = Number(inst.value||0);
    const rate = Number(debt.interestRate||0);
    const interest = instValue * rate / 100;
    const carry = instValue + interest;
    function fmtN(v) { return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
    setGcData({
      title: '❌ Registrar Não Pagamento',
      style: 'danger',
      msg: `<strong>${debt.name}</strong> não pagou a parcela ${inst.number}/${debt.installments}.<br><br>Valor: <strong>R$ ${fmtN(instValue)}</strong><br>Juros (${rate}%): R$ ${fmtN(interest)}<br>Total a transferir: <strong>R$ ${fmtN(carry)}</strong><br><br>Este valor será somado à próxima parcela.`,
      label: '❌ Confirmar — Não Pagou',
      fn: () => skipPayment(debt, inst, idx),
    });
    setGcModal(true);
  }

  // ── Settings ───────────────────────────────────────────────────────────
  async function saveSettings() {
    setBtnLoading(b => ({...b, settings: true}));
    try {
      const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify(settForm) });
      if (r?.ok) {
        const s = await r.json();
        setSettings({ ...DEFAULT_SETTINGS, ...s });
        toast('Configurações salvas!', 'success', 'Salvo ✓');
      }
    } finally {
      setBtnLoading(b => ({...b, settings: false}));
    }
  }
  async function testWhatsApp() {
    await saveSettings();
    if (!settForm.apiUrl || !settForm.instance || !settForm.apiKey) {
      toast('Preencha URL, instância e API Key', 'warning', 'Campos obrigatórios'); return;
    }
    const url = `${settForm.apiUrl.replace(/\/$/, '')}/instance/connectionState/${settForm.instance}`;
    try {
      const r    = await fetch(url, { headers: { apikey: settForm.apiKey } });
      const data = await r.json();
      const st   = data?.instance?.state || data?.state || 'open';
      if (st === 'open') toast('WhatsApp conectado!', 'success', 'Conexão OK ✓');
      else               toast(`Estado: ${st}`, 'warning', 'Atenção');
    } catch { toast('Falha na conexão. Verifique a URL.', 'danger', 'Erro'); }
  }
  async function runSchedulerNow() {
    toast('Verificando vencimentos...', 'info', 'Scheduler');
    const r = await api('/api/cron/scheduler', { method: 'POST' });
    if (r?.ok) { toast('Verificação concluída!', 'success', 'Scheduler'); fetchAll(); }
  }
  async function clearActivity() {
    const r = await api('/api/activity', { method: 'DELETE' });
    if (r?.ok) { fetchAll(); toast('Histórico limpo', 'success', 'Limpo'); }
  }

  // ── Export / Import ────────────────────────────────────────────────────
  function exportData() {
    const blob = new Blob([JSON.stringify({ debts, activity, settings }, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url;
    a.download = `debtflow-backup-${today}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('Dados exportados!', 'success', 'Exportado');
  }
  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.debts || !Array.isArray(data.debts)) throw new Error('Formato inválido');
        // Re-importar cada dívida
        for (const d of data.debts) {
          await api('/api/debts', { method: 'POST', body: JSON.stringify({
            name: d.name, phone: d.phone, product: d.product, total: d.total,
            installments: d.installments, dueDay: d.dueDay, interestRate: d.interestRate,
            notes: d.notes, startDate: d.createdAt,
          })});
        }
        fetchAll();
        toast('Dados importados!', 'success', 'Importado');
      } catch { toast('Arquivo inválido', 'danger', 'Erro'); }
    };
    reader.readAsText(file);
  }
  function confirmClearAll() {
    setGcData({
      title: 'Limpar todos os dados', style: 'danger',
      msg: 'Tem certeza? <strong>Todas as dívidas e histórico</strong> serão apagados permanentemente.',
      label: 'Limpar tudo',
      fn: async () => {
        await Promise.all(debts.map(d => api(`/api/debts/${d.id}`, { method: 'DELETE' })));
        await api('/api/activity', { method: 'DELETE' });
        fetchAll(); toast('Todos os dados foram removidos', 'warning', 'Dados limpos');
      },
    });
    setGcModal(true);
  }

  // ── Logout ─────────────────────────────────────────────────────────────
  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
  }

  // ── KPIs ───────────────────────────────────────────────────────────────
  const thisMonth = today.slice(0, 7);
  const { totalOpen, received, overdueCount, upcomingCount } = useMemo(() => {
    let totalOpen = 0, received = 0, overdueCount = 0, upcomingCount = 0;
    debts.forEach(d => {
      d.installmentList?.forEach(i => {
        if (i.status === 'paid' || i.status === 'partial') {
          if (i.paidDate?.startsWith(thisMonth)) received += (i.paidAmount ?? i.value);
        } else if (i.status === 'skipped') {
          // saldo transferido para próxima parcela, não conta como aberto nem recebido
        } else {
          totalOpen += i.value;
          const diff = daysDiff(today, i.dueDate);
          if (diff < 0)               overdueCount++;
          if (diff >= 0 && diff <= 5) upcomingCount++;
        }
      });
    });
    return { totalOpen, received, overdueCount, upcomingCount };
  }, [debts, today, thisMonth]);

  // ── Filtered debts ─────────────────────────────────────────────────────
  const filteredDebts = useMemo(() => {
    const list = debts.filter(d => {
      const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.product.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (filter === 'all')     return true;
      if (filter === 'paid')    return d.status === 'paid';
      if (filter === 'overdue') return d.status === 'overdue';
      if (filter === 'pending') return d.status === 'pending';
      if (filter === 'upcoming') {
        const next = d.installmentList?.find(i => !['paid','partial','skipped'].includes(i.status));
        if (!next) return false;
        const diff = daysDiff(today, next.dueDate);
        return diff >= 0 && diff <= 5;
      }
      return true;
    });
    return list.sort((a, b) => {
      if (sortOrder === 'alpha') return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      // date: mais recentes primeiro
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }, [debts, search, filter, today, sortOrder]);

  // Debts ordenados para o dashboard (todos, sem filtro de busca/status)
  const sortedDebts = useMemo(() => [
    ...debts
  ].sort((a, b) => {
    if (sortOrder === 'alpha') return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }), [debts, sortOrder]);

  // ── Calendar items ─────────────────────────────────────────────────────
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const calItems = useMemo(() => {
    const items = [];
    debts.forEach(debt => {
      debt.installmentList?.forEach((inst, idx) => {
        if (['paid','partial','skipped'].includes(inst.status)) return;
        const d    = new Date(inst.dueDate + 'T00:00:00');
        const diff = daysDiff(today, inst.dueDate);
        if ((d.getFullYear() === year && d.getMonth() === month) || diff < 0) {
          items.push({ debt, inst, idx });
        }
      });
    });
    return items.sort((a, b) => a.inst.dueDate.localeCompare(b.inst.dueDate));
  }, [debts, today, year, month]);

  // ── Bar chart data ─────────────────────────────────────────────────────
  const { months, maxBar } = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: d.toLocaleString('pt-BR', { month: 'short' }),
        value: 0,
      });
    }
    debts.forEach(d => d.installmentList?.forEach(i => {
      if ((i.status === 'paid' || i.status === 'partial') && i.paidDate) {
        const m = months.find(mo => i.paidDate.startsWith(mo.key));
        if (m) m.value += (i.paidAmount ?? i.value);
      }
    }));
    return { months, maxBar: Math.max(...months.map(m => m.value), 1) };
  }, [debts, year, month]);

  // ════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════
  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-base)' }}>
      <div style={{ textAlign:'center' }}>
        <div className="spinner" style={{ width:32, height:32, borderWidth:3, margin:'0 auto 12px' }}></div>
        <div style={{ color:'var(--text-muted)', fontSize:14 }}>Carregando DebtFlow...</div>
      </div>
    </div>
  );

  return (
    <div className="app-layout">

      {/* ── SIDEBAR ─────────────────────────────────────────────── */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-title">DebtFlow</span>
            <span className="sidebar-logo-subtitle">Gestão de Cobranças</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <span className="nav-section-label">Principal</span>
          {[
            { id:'dashboard', label:'Dashboard', icon: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></> },
            { id:'debts',     label:'Dívidas',   icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
            { id:'calendar',  label:'Vencimentos',icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></> },
            { id:'activity',  label:'Atividade', icon: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/> },
          ].map(({ id, label, icon }) => (
            <div key={id} className={`nav-item${page===id?' active':''}`} onClick={() => navigate(id)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
              {label}
              {id === 'debts' && overdueCount > 0 && (
                <span className="nav-badge">{overdueCount}</span>
              )}
            </div>
          ))}
          <span className="nav-section-label">Configuração</span>
          <div className={`nav-item${page==='settings'?' active':''}`} onClick={() => navigate('settings')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Configurações
          </div>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user" onClick={logout} title="Sair">
            <div className="sidebar-avatar">A</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{adminName}</div>
              <div className="sidebar-user-role">Clique para sair</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <main className="main-content">
        {/* Top Header */}
        <header className="top-header">
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <button className="mobile-menu-btn" onClick={() => setSidebarOpen(o => !o)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div className="header-left">
              <div className="header-title">{PAGE_META[page]?.title || ''}</div>
              <div className="header-subtitle">{PAGE_META[page]?.subtitle || ''}</div>
            </div>
          </div>
          <div className="header-actions">
            <div className="header-search">
              <svg className="header-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{cursor: search.trim() ? 'pointer' : 'default'}}
                onClick={() => { if (search.trim()) setPage('debts'); }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" placeholder="Buscar devedor..." value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && search.trim()) setPage('debts'); }} />
            </div>
            <button className="btn btn-primary" onClick={openNewDebt}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Nova Dívida
            </button>
          </div>

          {/* Mobile-only: compact header row */}
          <div className="mobile-header-row">
            <div className="mobile-header-brand">
              <div className="mobile-header-logo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <div>
                <div className="mobile-header-title">DebtFlow</div>
                <div className="mobile-header-page">{PAGE_META[page]?.title || ''}</div>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {overdueCount > 0 && (
                <div className="mobile-overdue-pill" onClick={() => navigate('debts')}>
                  <span>{overdueCount}</span> vencidas
                </div>
              )}
              <button
                className={`mobile-nav-toggle${mobileMenuOpen ? ' open' : ''}`}
                onClick={() => setMobileMenuOpen(o => !o)}
                aria-label="Menu"
              >
                {mobileMenuOpen
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16"/></svg>
                }
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)}>
            <div className="mobile-dropdown" onClick={e => e.stopPropagation()}>
              {/* UX2: Mobile search */}
              <div style={{padding:'12px 16px 4px'}}>
                <div style={{position:'relative'}}>
                  <svg style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',width:14,height:14,color:'var(--text-muted)',pointerEvents:'none'}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Buscar devedor..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && search.trim()) { setPage('debts'); setMobileMenuOpen(false); } }}
                    style={{width:'100%',background:'var(--bg-elevated)',border:'1px solid var(--border-default)',borderRadius:'var(--radius-md)',padding:'8px 12px 8px 32px',fontSize:13,color:'var(--text-primary)',outline:'none',boxSizing:'border-box'}}
                  />
                </div>
              </div>
              {[
                { id:'dashboard', label:'Dashboard',   sub:'Visão geral',      icon:<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></> },
                { id:'debts',     label:'Dívidas',     sub:'Gerenciar cobranças', icon:<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>, badge: overdueCount },
                { id:'calendar',  label:'Vencimentos', sub:'Agenda de cobranças', icon:<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></> },
                { id:'activity',  label:'Atividade',   sub:'Histórico de ações', icon:<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/> },
                { id:'settings',  label:'Configurações', sub:'Ajustes do sistema', icon:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></> },
              ].map(({ id, label, sub, icon, badge }) => (
                <button key={id} className={`mobile-menu-item${page===id?' active':''}`} onClick={() => navigate(id)}>
                  <div className={`mobile-menu-icon${page===id?' active':''}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
                  </div>
                  <div className="mobile-menu-text">
                    <div className="mobile-menu-label">{label}{badge > 0 && <span className="mobile-menu-badge">{badge}</span>}</div>
                    <div className="mobile-menu-sub">{sub}</div>
                  </div>
                  {page === id && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16,color:'var(--color-primary)',marginLeft:'auto'}}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>
              ))}
              <div className="mobile-menu-divider"/>
              <button className="mobile-menu-item mobile-menu-logout" onClick={logout}>
                <div className="mobile-menu-icon danger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </div>
                <div className="mobile-menu-text">
                  <div className="mobile-menu-label">Sair</div>
                  <div className="mobile-menu-sub">{adminName}</div>
                </div>
              </button>
            </div>
          </div>
        )}

        <div className="page-content">

          {/* ══ DASHBOARD ══════════════════════════════════════════ */}
          {page === 'dashboard' && (
            <section>
              <div className="kpi-grid">
                {[
                  { label:'Total em Aberto', value:`R$ ${fmt(totalOpen)}`, cls:'primary', panel:null,       icon:<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></> },
                  { label:'Recebido no Mês', value:`R$ ${fmt(received)}`,  cls:'accent',  panel:'received', icon:<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></> },
                  { label:'Inadimplentes',   value:overdueCount,           cls:'danger',  panel:'overdue',  icon:<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></> },
                  { label:'Vence em 5 dias', value:upcomingCount,          cls:'warning', panel:'upcoming', icon:<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
                ].map(({ label, value, cls, icon, panel }) => (
                  <div key={label} className={`kpi-card ${cls}`}
                    onClick={panel ? () => setKpiPanel(panel) : undefined}
                    style={panel ? {cursor:'pointer',position:'relative'} : undefined}
                    title={panel ? 'Clique para detalhes' : undefined}>
                    <div className="kpi-header">
                      <span className="kpi-label">{label}</span>
                      <div className="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg></div>
                    </div>
                    <div className="kpi-value currency">{value}</div>
                    {panel && <span style={{position:'absolute',bottom:8,right:10,fontSize:10,opacity:.5,letterSpacing:.5}}>ver detalhes ▸</span>}
                  </div>
                ))}
              </div>

              <div className="dashboard-grid" style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:24 }}>
                <div>
                  <div className="section-header">
                    <div><div className="section-title">Dívidas Recentes</div><div className="section-subtitle">Últimas movimentações</div></div>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <button title={sortOrder==='alpha'?'Ordenar por data':'Ordenar A-Z'} onClick={() => setSortOrder(s => s==='date'?'alpha':'date')} style={{display:'flex',alignItems:'center',gap:4,padding:'4px 10px',fontSize:11,fontWeight:600,border:'1px solid var(--border-default)',borderRadius:'var(--radius-sm)',background:'var(--bg-elevated)',color:'var(--text-secondary)',cursor:'pointer',whiteSpace:'nowrap'}}>
                        {sortOrder==='alpha' ? <>&#128197; Data</> : <>A&#8202;→&#8202;Z</>}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate('debts')}>Ver todas</button>
                    </div>
                  </div>
                  <div className="table-container">
                    <table className="data-table"><thead><tr><th>Devedor</th><th>Produto</th><th>Valor Total</th><th>Próx. Vencimento</th><th>Status</th></tr></thead>
                      <tbody>
                        {sortedDebts.slice(0, 6).length === 0 ? (
                          <tr><td colSpan={5} style={{ textAlign:'center', padding:40, color:'var(--text-muted)' }}>Nenhuma dívida cadastrada</td></tr>
                        ) : sortedDebts.slice(0, 6).map(d => {
                          const next = d.installmentList?.find(i => !['paid','partial','skipped'].includes(i.status));
                          return (
                            <tr key={d.id} onClick={() => setSideDebt(d)} className={d.status==='overdue'?'row-overdue':''}>
                              <td><div className="table-name"><div className="table-avatar" style={{ background: avatarColor(d.name) }}>{d.name[0]?.toUpperCase()}</div><div>{d.name}{d.phone && <div style={{ fontSize:11, color:'var(--text-muted)' }}>{d.phone}</div>}</div></div></td>
                              <td>{d.product}</td>
                              <td className="currency"><strong>R$ {fmt(d.total)}</strong></td>
                              <td>{next ? fmtDate(next.dueDate) : '—'}</td>
                              <td><StatusBadge debt={d} today={today} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="section-header"><div><div className="section-title">Atividade Recente</div></div></div>
                  <div className="table-container" style={{ padding:'8px 16px' }}>
                    <ActivityList items={activity.slice(0, 5)} />
                  </div>
                  <div style={{ marginTop:24 }}>
                    <div className="chart-container">
                      <div className="section-title">Recebimentos — Últimos 6 Meses</div>
                      <div className="simple-bar-chart">
                        {months.map(m => (
                          <div key={m.key} className="bar-wrap">
                            <div className="bar" style={{ height: `${(m.value/maxBar)*100}%` }} title={`R$ ${fmt(m.value)}`}></div>
                            <div className="bar-label">{m.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ══ DÍVIDAS ════════════════════════════════════════════ */}
          {page === 'debts' && (
            <section>
              <div className="filter-bar" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                {[['all','Todas'],['pending','Pendentes'],['overdue','Em Atraso'],['upcoming','Vence em breve'],['paid','Liquidados']].map(([v,l]) => (
                  <button key={v} className={`filter-pill${filter===v?' active':''}`} onClick={() => setFilter(v)}>{l}</button>
                ))}
                <button title={sortOrder==='alpha'?'Ordenar por data':'Ordenar A-Z'} onClick={() => setSortOrder(s => s==='date'?'alpha':'date')} style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:4,padding:'4px 12px',fontSize:11,fontWeight:600,border:'1px solid var(--border-default)',borderRadius:'var(--radius-sm)',background:'var(--bg-elevated)',color:'var(--text-secondary)',cursor:'pointer',whiteSpace:'nowrap'}}>
                  {sortOrder==='alpha' ? <>&#128197; Data</> : <>A&#8202;→&#8202;Z</>}
                </button>
              </div>
              {/* ── Mobile: card list ── */}
              <div className="mobile-only">
                {filteredDebts.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
                    <div className="empty-title">Nenhuma dívida encontrada</div>
                    <div className="empty-subtitle">Toque no + para adicionar uma nova</div>
                  </div>
                ) : (
                  <div className="debt-cards-list">
                    {filteredDebts.map(d => {
                      const paidN = d.installmentList?.filter(i => i.status==='paid').length || 0;
                      const totalN = d.installmentList?.length || 0;
                      const nextInst = d.installmentList?.find(i => !['paid','partial','skipped'].includes(i.status));
                      const diff = nextInst ? daysDiff(today, nextInst.dueDate) : null;
                      let cardCls = 'debt-mobile-card';
                      if (diff !== null && diff < 0) cardCls += ' overdue';
                      else if (diff !== null && diff <= 5) cardCls += ' warning';
                      return (
                        <div key={d.id} className={cardCls} onClick={() => setSideDebt(d)}>
                          <div className="debt-mobile-card-top">
                            <div className="table-avatar" style={{ background:avatarColor(d.name), width:44, height:44, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, fontWeight:800, color:'#fff', flexShrink:0 }}>
                              {d.name[0]?.toUpperCase()}
                            </div>
                            <div className="debt-mobile-card-info">
                              <div className="debt-mobile-card-name">{d.name}</div>
                              <div className="debt-mobile-card-sub">{d.product}{d.phone && ` · ${d.phone}`}</div>
                            </div>
                            <StatusBadge debt={d} today={today} />
                          </div>
                          <div className="debt-mobile-card-mid">
                            <div>
                              <div className="debt-mobile-card-value">R$ {fmt(d.total)}</div>
                              <div className="debt-mobile-card-inst">{paidN}/{totalN} parcelas · Dia {d.dueDay} · {d.interestRate}%a.m.</div>
                            </div>
                            {nextInst && (
                              <div style={{fontSize:12,color:'var(--text-muted)',textAlign:'right'}}>
                                <div>Próximo</div>
                                <div style={{fontWeight:600,color:'var(--text-secondary)'}}>{fmtDate(nextInst.dueDate)}</div>
                              </div>
                            )}
                          </div>
                          <div className="debt-mobile-card-actions" onClick={e => e.stopPropagation()}>
                            {d.phone && nextInst && (
                              <button className="card-action-btn card-action-cobrar" onClick={() => sendWhatsApp(d, nextInst)}>Cobrar</button>
                            )}
                            <button className="card-action-btn card-action-edit" onClick={() => openEditDebt(d)}>Editar</button>
                            <button className="card-action-btn card-action-del" onClick={() => { setDelDebt(d); setDelModal(true); }}>Excluir</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Desktop: tabela ── */}
              <div className="table-container desktop-only">
                {filteredDebts.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
                    <div className="empty-title">Nenhuma dívida encontrada</div>
                    <div className="empty-subtitle">Adicione uma nova dívida ou ajuste os filtros</div>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Devedor</th><th>Produto</th><th>Valor Total</th><th>Parcelas</th><th>Vencimento</th><th>Juros/mês</th><th>Status</th><th>Ações</th></tr></thead>
                    <tbody>
                      {filteredDebts.map(d => {
                        const paid = d.installmentList?.filter(i => i.status==='paid').length || 0;
                        const total = d.installmentList?.length || 0;
                        return (
                          <tr key={d.id} className={d.status==='overdue'?'row-overdue':''} onClick={() => setSideDebt(d)}>
                            <td><div className="table-name"><div className="table-avatar" style={{ background:avatarColor(d.name) }}>{d.name[0]?.toUpperCase()}</div><div>{d.name}{d.phone&&<div style={{fontSize:11,color:'var(--text-muted)'}}>{d.phone}</div>}</div></div></td>
                            <td>{d.product}</td>
                            <td className="currency"><strong>R$ {fmt(d.total)}</strong></td>
                            <td>
                              <div style={{fontSize:13}}>{paid}/{total} pagas</div>
                              <div className="progress-bar" style={{marginTop:6,width:80}}><div className="progress-fill" style={{width:`${total>0?(paid/total*100):0}%`}}></div></div>
                            </td>
                            <td>Dia {d.dueDay}</td>
                            <td><span style={{color:'var(--color-warning)'}}>{d.interestRate}% a.m.</span></td>
                            <td><StatusBadge debt={d} today={today} /></td>
                            <td onClick={e => e.stopPropagation()}>
                              <div style={{display:'flex',gap:6}}>
                                <button className="btn btn-sm btn-ghost btn-icon" aria-label="Editar dívida" data-tooltip="Editar" onClick={() => openEditDebt(d)}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                {d.phone && (
                                  <a className="btn btn-sm btn-ghost btn-icon" href={`https://wa.me/${d.phone}`} target="_blank" rel="noopener" aria-label="Abrir WhatsApp" data-tooltip="WhatsApp" onClick={e => e.stopPropagation()}>
                                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                  </a>
                                )}
                                <button className="btn btn-sm btn-ghost btn-icon" aria-label="Excluir dívida" data-tooltip="Excluir" style={{color:'var(--color-danger)'}} onClick={() => { setDelDebt(d); setDelModal(true); }}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {/* ══ VENCIMENTOS ════════════════════════════════════════ */}
          {page === 'calendar' && (
            <section>
              <div className="section-header">
                <div>
                  <div className="section-title">Vencimentos do Mês</div>
                  <div className="section-subtitle">{new Date().toLocaleString('pt-BR',{month:'long',year:'numeric'}).replace(/^\w/, c => c.toUpperCase())}</div>
                </div>
              </div>
              {calItems.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
                  <div className="empty-title">Sem vencimentos este mês</div>
                  <div className="empty-subtitle">Todas as parcelas deste mês foram pagas</div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {calItems.map(({ debt, inst, idx }) => {
                    const diff = daysDiff(today, inst.dueDate);
                    const d    = new Date(inst.dueDate + 'T00:00:00');
                    let cls = '', diffLabel = null;
                    if (diff < 0)        { cls = 'row-overdue'; diffLabel = <span style={{color:'var(--color-danger)',fontSize:11}}>{Math.abs(diff)} dias atrasado</span>; }
                    else if (diff === 0) { cls = 'row-warning'; diffLabel = <span style={{color:'var(--color-warning)',fontSize:11}}>Vence hoje</span>; }
                    else if (diff <= 5)  { cls = 'row-warning'; diffLabel = <span style={{color:'var(--color-warning)',fontSize:11}}>Em {diff} dia(s)</span>; }
                    else                 { diffLabel = <span style={{color:'var(--text-muted)',fontSize:11}}>Em {diff} dias</span>; }
                    return (
                      <div key={`${debt.id}-${idx}`} className={`table-container ${cls}`} style={{padding:'16px 20px',cursor:'pointer'}} onClick={() => setSideDebt(debt)}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
                          <div style={{display:'flex',alignItems:'center',gap:14}}>
                            <div style={{textAlign:'center',minWidth:42}}>
                              <div style={{fontSize:22,fontWeight:800,color:'var(--text-primary)',lineHeight:1}}>{d.getDate()}</div>
                              <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase'}}>{d.toLocaleString('pt-BR',{weekday:'short'})}</div>
                            </div>
                            <div style={{width:1,height:40,background:'var(--border-subtle)'}}></div>
                            <div>
                              <div style={{fontWeight:600}}>{debt.name}</div>
                              <div style={{fontSize:12,color:'var(--text-muted)'}}>{debt.product} — Parcela {inst.number}/{debt.installments}</div>
                              <div style={{marginTop:2}}>{diffLabel}</div>
                            </div>
                          </div>
                          <div style={{display:'flex',alignItems:'center',gap:12}}>
                            <div style={{textAlign:'right'}}>
                              <div style={{fontSize:18,fontWeight:700}} className="currency">R$ {fmt(inst.value)}</div>
                              {inst.isPenalty && <div style={{fontSize:11,color:'var(--color-warning)'}}>+{inst.penaltyRate}% juros</div>}
                            </div>
                            <div style={{display:'flex',gap:8}} onClick={e => e.stopPropagation()}>
                              {debt.phone && (
                                <button className="btn btn-sm" style={{background:'#25D366',color:'#fff',border:'none'}} onClick={() => sendWhatsApp(debt, inst)}>
                                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                  Cobrar
                                </button>
                              )}
                              <button className="btn btn-accent btn-sm" onClick={() => openPayModal(debt, inst, idx)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4}}><polyline points="20 6 9 17 4 12"/></svg>
                                Pagar
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ══ ATIVIDADE ══════════════════════════════════════════ */}
          {page === 'activity' && (
            <section>
              <div className="section-header">
                <div><div className="section-title">Histórico de Atividades</div><div className="section-subtitle">Todos os eventos registrados</div></div>
                <button className="btn btn-ghost btn-sm" onClick={clearActivity}>Limpar histórico</button>
              </div>
              <div className="table-container" style={{ padding:'8px 24px' }}>
                <ActivityList items={activity} />
              </div>
            </section>
          )}

          {/* ══ CONFIGURAÇÕES ══════════════════════════════════════ */}
          {page === 'settings' && (
            <section>
              {/* WhatsApp */}
              <div className="settings-card">
                <div className="settings-card-title">
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{width:16,height:16,color:'#25D366'}}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  WhatsApp — Evolution API <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:400}}>(opcional)</span>
                </div>
                <div className="settings-card-subtitle">Sem API configurada, o botão "Cobrar" abre o WhatsApp com a mensagem pronta — 100% gratuito.</div>
                <div className="form-grid">
                  {[['apiUrl','URL da API','https://sua-api.com','url'],['instance','Nome da Instância','minha-instancia','text'],['apiKey','API Key','••••••••••••••••','password']].map(([k,l,ph,t]) => (
                    <div className="form-group" key={k}>
                      <label className="form-label">{l}</label>
                      <input className="form-control" type={t} placeholder={ph} value={settForm[k]||''} onChange={e => setSettForm(s=>({...s,[k]:e.target.value}))} />
                    </div>
                  ))}
                  <div className="form-group">
                    <label className="form-label">Juros Padrão (%/mês)</label>
                    <input className="form-control" type="number" min="0" max="100" step="0.1" value={settForm.defaultInterest||2} onChange={e => setSettForm(s=>({...s,defaultInterest:parseFloat(e.target.value)}))} />
                  </div>
                </div>
                <div className="settings-divider"></div>
                {[['msgTemplate','Template de Cobrança'],['msgOverdue','Template de Atraso']].map(([k,l]) => (
                  <div className="form-group" key={k} style={{marginBottom:16}}>
                    <label className="form-label">{l}</label>
                    <textarea className="form-control" rows={4} value={settForm[k]||''} onChange={e => setSettForm(s=>({...s,[k]:e.target.value}))} />
                    <div style={{display:'flex',alignItems:'center',gap:12,marginTop:4,flexWrap:'wrap'}}>
                      <span className="form-hint" style={{flex:1}}>Variáveis: {'{nome}'}, {'{valor}'}, {'{vencimento}'}, {'{produto}'}, {'{parcela}'}, {'{total_parcelas}'}{k==='msgOverdue'?`, {'{valor_com_juros}'}, {'{dias_atraso}'}`:''}  </span>
                      <button type="button" className="btn btn-ghost btn-sm" style={{fontSize:11,padding:'2px 8px',minHeight:'unset',whiteSpace:'nowrap'}} onClick={() => setSettForm(s=>({...s,[k]:DEFAULT_SETTINGS[k]}))}>↺ Redefinir padrão</button>
                    </div>
                  </div>
                ))}
                <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                  <button className="btn btn-primary" onClick={saveSettings} disabled={btnLoading.settings} aria-busy={!!btnLoading.settings}>
                    {btnLoading.settings
                      ? <><span className="spinner" style={{width:14,height:14,borderWidth:2,marginRight:6}}></span>Salvando...</>
                      : 'Salvar Configurações'}
                  </button>
                  <button className="btn btn-ghost" onClick={testWhatsApp}>Testar Conexão API</button>
                </div>
              </div>

              {/* Scheduler */}
              <div className="settings-card">
                <div className="settings-card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Agendamento Automático
                </div>
                <div className="settings-card-subtitle">Cron Job no Vercel — executa a cada hora, mesmo com o site fechado</div>
                {[['Intervalo','A cada 1 hora (Vercel Cron)'],['Cobrança','No dia do vencimento'],['Juros','5 dias após vencimento']].map(([l,v]) => (
                  <div className="stat-row" key={l}><span className="stat-row-label">{l}</span><span className="stat-row-value">{v}</span></div>
                ))}
                <div style={{marginTop:16}}>
                  <button className="btn btn-ghost btn-sm" onClick={runSchedulerNow}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.18"/></svg>
                    Verificar agora
                  </button>
                </div>
              </div>

              {/* Dados */}
              <div className="settings-card">
                <div className="settings-card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                  Dados do Sistema
                </div>
                <div className="settings-card-subtitle">Exportar backup ou importar dados</div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                  <button className="btn btn-ghost btn-sm" onClick={exportData}>Exportar JSON</button>
                  <label className="btn btn-ghost btn-sm" style={{cursor:'pointer'}}>
                    Importar JSON
                    <input type="file" accept=".json" onChange={importData} style={{display:'none'}} />
                  </label>
                  <button className="btn btn-danger btn-sm" onClick={confirmClearAll}>Limpar tudo</button>
                </div>
              </div>
            </section>
          )}

        </div>
      </main>

      {/* ── FAB: Nova Dívida (mobile) ─────────────────────────────── */}
      <button className="fab" onClick={openNewDebt} aria-label="Nova Dívida">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {/* ── SIDE PANEL: Detalhe da Dívida ─────────────────────── */}
      <div className={`side-panel-backdrop${sideDebt?' open':''}`} onClick={e => { if (e.target === e.currentTarget) setSideDebt(null); }}>
        <div className="side-panel">
          {sideDebt && <DebtPanel debt={sideDebt} today={today} onClose={() => setSideDebt(null)} onEdit={d => { setSideDebt(null); setTimeout(()=>openEditDebt(d),300); }} onPay={openPayModal} onSkip={confirmSkipPayment} onDelete={d => { setSideDebt(null); setDelDebt(d); setDelModal(true); }} onWhatsApp={sendWhatsApp} />}
        </div>
      </div>

      {/* ── MODAL: Nova / Editar Dívida ─────────────────────────── */}
      <Modal open={debtModal} onClose={() => setDebtModal(false)} title={editId ? 'Editar Dívida' : 'Nova Dívida'} subtitle="Preencha os dados do devedor e da dívida" maxWidth={640}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Nome do Devedor <span>*</span></label>
            <input className={`form-control${formErrors.name ? ' input-error' : ''}`} type="text" placeholder="João Silva" value={debtForm.name||''} onChange={e=>{setDebtForm(f=>({...f,name:e.target.value}));if(formErrors.name)setFormErrors(fe=>({...fe,name:undefined}));}} />
            {formErrors.name && <span className="form-hint" style={{color:'var(--color-danger)'}}>{formErrors.name}</span>}
          </div>
          <div className="form-group">
            <label className="form-label">WhatsApp <span style={{color:'var(--color-danger)'}}>*</span></label>
            <input className={`form-control${formErrors.phone ? ' input-error' : ''}`} type="tel" placeholder="5511999999999" value={debtForm.phone||''} onChange={e=>{setDebtForm(f=>({...f,phone:e.target.value}));if(formErrors.phone)setFormErrors(fe=>({...fe,phone:undefined}));}} />
            {formErrors.phone && <span className="form-hint" style={{color:'var(--color-danger)'}}>{formErrors.phone}</span>}
          </div>
          <div className="form-group full-width">
            <label className="form-label">Endereço</label>
            <input className="form-control" type="text" placeholder="Rua das Flores, 123 — Bairro, Cidade/UF" value={debtForm.address||''} onChange={e=>setDebtForm(f=>({...f,address:e.target.value}))} />
          </div>
          <div className="form-group full-width">
            <label className="form-label">Produto / Serviço <span>*</span></label>
            <input className={`form-control${formErrors.product ? ' input-error' : ''}`} type="text" placeholder="Ex: Notebook Dell, Serviço de Design..." value={debtForm.product||''} onChange={e=>{setDebtForm(f=>({...f,product:e.target.value}));if(formErrors.product)setFormErrors(fe=>({...fe,product:undefined}));}} />
            {formErrors.product && <span className="form-hint" style={{color:'var(--color-danger)'}}>{formErrors.product}</span>}
          </div>
          <div className="form-group">
            <label className="form-label">Valor Total <span>*</span></label>
            <div className="input-prefix-wrapper"><span className="input-prefix">R$</span>
              <input className={`form-control${formErrors.total ? ' input-error' : ''}`} type="number" min="0.01" step="0.01" placeholder="0,00" value={debtForm.total||''} onChange={e=>{setDebtForm(f=>({...f,total:e.target.value}));if(formErrors.total)setFormErrors(fe=>({...fe,total:undefined}));}} />
            </div>
            {formErrors.total && <span className="form-hint" style={{color:'var(--color-danger)'}}>{formErrors.total}</span>}
          </div>
          <div className="form-group">
            <label className="form-label">Número de Parcelas <span>*</span></label>
            <input className={`form-control${formErrors.installments ? ' input-error' : ''}`} type="number" min="1" max="360" placeholder="1" value={debtForm.installments||''} onChange={e=>{setDebtForm(f=>({...f,installments:e.target.value}));if(formErrors.installments)setFormErrors(fe=>({...fe,installments:undefined}));}} />
            {formErrors.installments && <span className="form-hint" style={{color:'var(--color-danger)'}}>{formErrors.installments}</span>}
          </div>
          {!editId && (
            <div className="form-group">
              <label className="form-label">Parcelas já pagas</label>
              <input
                className="form-control" type="number" min="0"
                placeholder="0"
                value={debtForm.paidInstallments||''}
                onChange={e=>setDebtForm(f=>({...f,paidInstallments:e.target.value}))}
              />
              <span className="form-hint">As primeiras N parcelas serão marcadas como pagas automaticamente</span>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Dia de Vencimento <span>*</span></label>
            <input className={`form-control${formErrors.dueDay ? ' input-error' : ''}`} type="number" min="1" max="28" placeholder="10" value={debtForm.dueDay||''} onChange={e=>{setDebtForm(f=>({...f,dueDay:e.target.value}));if(formErrors.dueDay)setFormErrors(fe=>({...fe,dueDay:undefined}));}} />
            {formErrors.dueDay
              ? <span className="form-hint" style={{color:'var(--color-danger)'}}>{formErrors.dueDay}</span>
              : <span className="form-hint">Entre 1 e 28</span>}
          </div>
          <div className="form-group">
            <label className="form-label">Juros por Atraso (%/mês)</label>
            <input className="form-control" type="number" min="0" max="100" step="0.1" value={debtForm.interestRate??10} onChange={e=>setDebtForm(f=>({...f,interestRate:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="form-label">Data de Início <span>*</span></label>
            <input className={`form-control${formErrors.startDate ? ' input-error' : ''}`} type="date" value={debtForm.startDate||''} onChange={e=>{setDebtForm(f=>({...f,startDate:e.target.value}));if(formErrors.startDate)setFormErrors(fe=>({...fe,startDate:undefined}));}} />
            {formErrors.startDate && <span className="form-hint" style={{color:'var(--color-danger)'}}>{formErrors.startDate}</span>}
          </div>
          <div className="form-group full-width">
            <label className="form-label">Observações</label>
            <textarea className="form-control" rows={2} placeholder="Notas adicionais..." value={debtForm.notes||''} onChange={e=>setDebtForm(f=>({...f,notes:e.target.value}))} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setDebtModal(false)} disabled={btnLoading.save}>Cancelar</button>
          <button className="btn btn-primary" onClick={saveDebt} disabled={btnLoading.save} aria-busy={!!btnLoading.save}>
            {btnLoading.save
              ? <><span className="spinner" style={{width:14,height:14,borderWidth:2,marginRight:6}}></span>Salvando...</>
              : (editId ? 'Salvar Alterações' : 'Salvar Dívida')}
          </button>
        </div>
      </Modal>

      {/* ── MODAL: Pagamento ─────────────────────────────────────── */}
      <Modal open={payModal} onClose={() => { setPayModal(false); setPayStep('enter'); }} title={payStep==='preview' ? 'Confirmar Pagamento Parcial' : 'Registrar Pagamento'} subtitle={payStep==='preview' ? 'Revise os valores antes de confirmar' : 'Confirme o pagamento da parcela'} maxWidth={420}>
        {payInfo.inst && payStep === 'enter' && <>
          {[['Devedor',payInfo.debt?.name],['Parcela',`${payInfo.inst.number}/${payInfo.debt?.installments}${payInfo.inst.isPenalty?' (c/ juros)':''}`],['Valor Devido',`R$ ${fmt(payInfo.inst.value)}`],['Vencimento',fmtDate(payInfo.inst.dueDate)]].map(([l,v]) => (
            <div className="stat-row" key={l}><span className="stat-row-label">{l}</span><span className="stat-row-value currency">{v}</span></div>
          ))}
          <div className="form-group" style={{marginTop:16}}>
            <label className="form-label">Valor Pago</label>
            <div className="input-prefix-wrapper">
              <span className="input-prefix">R$</span>
              <input className="form-control" type="number" step="0.01" min="0.01"
                value={payInfo.payAmount ?? ''}
                onChange={e => setPayInfo(p => ({...p, payAmount: e.target.value}))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Data do Pagamento</label>
            <input className="form-control" type="date" value={payInfo.date} onChange={e=>setPayInfo(p=>({...p,date:e.target.value}))} />
          </div>
        </>}
        {payInfo.inst && payStep === 'preview' && (() => {
          const dueVal  = parseFloat(payInfo.inst.value) || 0;
          const payAmt  = parseFloat(payInfo.payAmount)  || 0;
          const saldo   = parseFloat((dueVal - payAmt).toFixed(2));
          const taxa    = parseFloat(payInfo.debt?.interestRate) || 0;
          const juros   = parseFloat((saldo * taxa / 100).toFixed(2));
          const carry   = parseFloat((saldo + juros).toFixed(2));
          const rows = [
            ['Valor da parcela',         `R$ ${fmt(dueVal)}`,  null],
            ['Valor informado',          `R$ ${fmt(payAmt)}`,  'var(--color-accent)'],
            ['Saldo não pago',           `R$ ${fmt(saldo)}`,   'var(--color-warning)'],
            [`Juros sobre o saldo (${taxa}%)`, `R$ ${fmt(juros)}`, '#f5a623'],
            ['Total para próxima parcela', `R$ ${fmt(carry)}`, 'var(--color-danger)'],
          ];
          return (
            <div style={{display:'flex',flexDirection:'column',gap:0}}>
              {rows.map(([l,v,c]) => (
                <div key={l} className="stat-row" style={{borderBottom:'1px solid var(--border-default)',padding:'10px 0'}}>
                  <span className="stat-row-label" style={{fontSize:13}}>{l}</span>
                  <span className="stat-row-value currency" style={{fontWeight:700,color:c||'var(--text-primary)'}}>{v}</span>
                </div>
              ))}
              <div style={{marginTop:12,padding:'10px 12px',background:'rgba(255,165,0,.08)',borderRadius:'var(--radius-md)',border:'1px solid rgba(255,165,0,.2)',fontSize:12,color:'var(--color-warning)',lineHeight:1.5}}>
                ⚠️ O valor de <strong>R$ {fmt(carry)}</strong> (saldo + juros de {taxa}%) será adicionado à próxima parcela em aberto.
              </div>
            </div>
          );
        })()}
        <div className="modal-footer">
          {payStep === 'preview'
            ? <>
                <button className="btn btn-ghost" onClick={() => setPayStep('enter')} disabled={btnLoading.pay}>← Voltar</button>
                <button className="btn btn-accent" onClick={confirmPayment} disabled={btnLoading.pay} aria-busy={!!btnLoading.pay}>
                  {btnLoading.pay
                    ? <><span className="spinner" style={{width:14,height:14,borderWidth:2,marginRight:6}}></span>Processando...</>
                    : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Confirmar mesmo assim</>}
                </button>
              </>
            : <>
                <button className="btn btn-ghost" onClick={() => { setPayModal(false); setPayStep('enter'); }} disabled={btnLoading.pay}>Cancelar</button>
                <button className="btn btn-accent" onClick={handlePaySubmit} disabled={btnLoading.pay} aria-busy={!!btnLoading.pay}>
                  {btnLoading.pay
                    ? <><span className="spinner" style={{width:14,height:14,borderWidth:2,marginRight:6}}></span>Processando...</>
                    : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Confirmar Pagamento</>}
                </button>
              </>}
        </div>
      </Modal>

      {/* ── MODAL: Excluir Dívida ─────────────────────────────────── */}
      <Modal open={delModal} onClose={() => setDelModal(false)} title="Excluir Dívida" titleStyle={{ color:'var(--color-danger)' }} subtitle="Esta ação não pode ser desfeita" maxWidth={420}>
        <p style={{color:'var(--text-secondary)',fontSize:14,lineHeight:1.6}}>
          Tem certeza que deseja excluir a dívida de <strong style={{color:'var(--text-primary)'}}>{delDebt?.name}</strong>?
          Todo o histórico de parcelas será removido permanentemente.
        </p>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setDelModal(false)} disabled={btnLoading.delete}>Cancelar</button>
          <button className="btn btn-danger" onClick={() => delDebt && deleteDebt(delDebt)} disabled={btnLoading.delete} aria-busy={!!btnLoading.delete}>
            {btnLoading.delete
              ? <><span className="spinner" style={{width:14,height:14,borderWidth:2,marginRight:6}}></span>Excluindo...</>
              : 'Excluir Definitivamente'}
          </button>
        </div>
      </Modal>

      {/* ── KPI PANEL ───────────────────────────────────────────── */}
      {kpiPanel && (() => {
        const fmtV = v => Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
        const fmtD = s => { if(!s) return '—'; const[y,m,d]=s.split('-'); return `${d}/${m}/${y}`; };
        const diffDays = (a,b) => { const ms=new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'); return Math.round(ms/86400000); };
        const thisMonth = today.slice(0,7);

        let title, rows, cols;

        if (kpiPanel === 'received') {
          title = `Recebido em ${new Date(thisMonth+'-01').toLocaleString('pt-BR',{month:'long',year:'numeric'})}`;
          rows = [];
          debts.forEach(d => {
            (d.installmentList||[]).forEach(inst => {
              if (!['paid','partial'].includes(inst.status)) return;
              if (!inst.paidDate?.startsWith(thisMonth)) return;
              const paid = inst.paidAmount ?? inst.value;
              const _rate = parseFloat(d.interestRate) || 0;
              let juros = 0;
              if (inst.status === 'partial') {
                // Juro sobre o saldo que será transferido para a próxima parcela
                const _saldo = Math.max(0, (inst.value||0) - (inst.paidAmount||0));
                juros = parseFloat((_saldo * _rate / 100).toFixed(2));
              } else if (inst.status === 'paid') {
                if (inst.penaltyApplied && inst.penaltyRate > 0) {
                  // Multa do scheduler (5+ dias de atraso): valor cresceu sobre o original
                  juros = Math.max(0, (inst.value||0) - (inst.originalValue||0));
                } else if ((inst.carriedInterest || 0) > 0) {
                  // Juro carregado de skip ou parcial anterior — campo gravado nas rotas skip/pay
                  juros = inst.carriedInterest;
                }
              }
              rows.push({ name: d.name, product: d.product, inst: `${inst.number}/${d.installments}`,
                paid, juros, date: inst.paidDate, status: inst.status });
            });
          });
          rows.sort((a,b) => (b.date||'').localeCompare(a.date||''));
          cols = ['Cliente','Produto','Parcela','Pago em','Valor Pago','Juros Inclusos'];
        }

        if (kpiPanel === 'overdue') {
          title = 'Clientes Inadimplentes';
          rows = [];
          debts.forEach(d => {
            (d.installmentList||[]).forEach(inst => {
              if (['paid','partial','skipped'].includes(inst.status)) return;
              const diff = diffDays(today, inst.dueDate);
              if (diff >= 0) return;
              rows.push({ name: d.name, phone: d.phone, product: d.product,
                inst: `${inst.number}/${d.installments}`, value: inst.value,
                dueDate: inst.dueDate, days: -diff });
            });
          });
          rows.sort((a,b) => b.days - a.days);
          cols = ['Cliente','WhatsApp','Produto','Parcela','Valor','Venceu em','Dias em Atraso'];
        }

        if (kpiPanel === 'upcoming') {
          title = 'Vencimentos nos próximos 5 dias';
          rows = [];
          debts.forEach(d => {
            (d.installmentList||[]).forEach(inst => {
              if (['paid','partial','skipped'].includes(inst.status)) return;
              const diff = diffDays(today, inst.dueDate);
              if (diff < 0 || diff > 5) return;
              rows.push({ name: d.name, phone: d.phone, product: d.product,
                inst: `${inst.number}/${d.installments}`, value: inst.value,
                dueDate: inst.dueDate, days: diff });
            });
          });
          rows.sort((a,b) => a.days - b.days);
          cols = ['Cliente','WhatsApp','Produto','Parcela','Valor','Vencimento','Dias Restantes'];
        }

        return (
          <div className="modal-backdrop open" onClick={e => { if(e.target===e.currentTarget) setKpiPanel(null); }}>
            <div className="modal" style={{maxWidth:720,maxHeight:'85vh',display:'flex',flexDirection:'column'}}>
              <div className="modal-header">
                <div><div className="modal-title">{title}</div>
                  <div className="modal-subtitle">{rows.length} {rows.length===1?'registro':'registros'}</div>
                </div>
                <button className="modal-close" onClick={() => setKpiPanel(null)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="modal-body" style={{overflowY:'auto',flex:1,padding:'12px 20px'}}>
                {rows.length === 0
                  ? <div style={{textAlign:'center',padding:32,color:'var(--text-muted)',fontSize:14}}>Nenhum registro encontrado.</div>
                  : (
                  <div className="table-container" style={{margin:0}}>
                    <table className="data-table" style={{fontSize:13}}>
                      <thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
                      <tbody>
                        {kpiPanel === 'received' && rows.map((r,i) => (
                          <tr key={i}>
                            <td><strong>{r.name}</strong></td>
                            <td>{r.product}</td>
                            <td>{r.inst}</td>
                            <td>{fmtD(r.date)}</td>
                            <td style={{color:'var(--color-success)',fontWeight:600}}>R$ {fmtV(r.paid)}</td>
                            <td>{r.juros > 0
                              ? <span style={{color:'#f5a623',fontWeight:600}}>R$ {fmtV(r.juros)}</span>
                              : <span style={{color:'var(--text-muted)'}}>—</span>}
                            </td>
                          </tr>
                        ))}
                        {kpiPanel === 'overdue' && rows.map((r,i) => (
                          <tr key={i}>
                            <td><strong>{r.name}</strong></td>
                            <td>{r.phone || '—'}</td>
                            <td>{r.product}</td>
                            <td>{r.inst}</td>
                            <td style={{fontWeight:600}}>R$ {fmtV(r.value)}</td>
                            <td>{fmtD(r.dueDate)}</td>
                            <td><span style={{color:'var(--color-danger)',fontWeight:700}}>{r.days} dia{r.days!==1?'s':''}</span></td>
                          </tr>
                        ))}
                        {kpiPanel === 'upcoming' && rows.map((r,i) => (
                          <tr key={i}>
                            <td><strong>{r.name}</strong></td>
                            <td>{r.phone || '—'}</td>
                            <td>{r.product}</td>
                            <td>{r.inst}</td>
                            <td style={{fontWeight:600}}>R$ {fmtV(r.value)}</td>
                            <td>{fmtD(r.dueDate)}</td>
                            <td>{r.days === 0
                              ? <span style={{color:'var(--color-warning)',fontWeight:700}}>Hoje</span>
                              : <span style={{color:'var(--color-accent)',fontWeight:700}}>{r.days} dia{r.days!==1?'s':''}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL: Confirmação genérica ──────────────────────────── */}
      <Modal open={gcModal} onClose={() => setGcModal(false)} title={gcData.title} maxWidth={420}>
        <p style={{color:'var(--text-secondary)',fontSize:14,lineHeight:1.6}} dangerouslySetInnerHTML={{ __html: gcData.msg }} />
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setGcModal(false)}>Cancelar</button>
          <button className={`btn btn-${gcData.style}`} onClick={() => { setGcModal(false); gcData.fn?.(); }}>{gcData.label}</button>
        </div>
      </Modal>

      {/* ── TOASTS ───────────────────────────────────────────────── */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <svg className="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {t.type==='success' && <polyline points="20 6 9 17 4 12"/>}
              {t.type==='danger'  && <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>}
              {t.type==='warning' && <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>}
              {t.type==='info'    && <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></>}
            </svg>
            <div className="toast-text">
              {t.title && <div className="toast-title">{t.title}</div>}
              <div className="toast-body">{t.msg}</div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────────────

function BottomNav({ page, navigate, overdueCount }) {
  const items = [
    {
      id: 'dashboard', label: 'Início',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    },
    {
      id: 'debts', label: 'Dívidas',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
      badge: overdueCount,
    },
    {
      id: 'calendar', label: 'Agenda',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    },
    {
      id: 'activity', label: 'Histórico',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    },
    {
      id: 'settings', label: 'Config',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    },
  ];
  return (
    <nav className="bottom-nav">
      {items.map(({ id, label, icon, badge }) => (
        <button key={id} className={`bottom-nav-item${page===id?' active':''}`} onClick={() => navigate(id)}>
          {icon}
          {badge > 0 && <span className="bottom-nav-badge">{badge > 9 ? '9+' : badge}</span>}
          <span className="bottom-nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Modal({ open, onClose, title, titleStyle, subtitle, children, maxWidth = 640 }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className={`modal-backdrop${open?' open':''}`} onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth }}>
        <div className="modal-header">
          <div>
            <div className="modal-title" style={titleStyle}>{title}</div>
            {subtitle && <div className="modal-subtitle">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function ActivityList({ items }) {
  if (!items || items.length === 0) return <div style={{textAlign:'center',padding:20,color:'var(--text-muted)',fontSize:13}}>Nenhuma atividade registrada</div>;
  return (
    <div className="activity-list">
      {items.map((act, i) => (
        <div key={act.id || i} className="activity-item">
          <div className="activity-dot" style={{ background: act.type==='success'?'var(--color-success)':act.type==='warning'?'var(--color-warning)':act.type==='danger'?'var(--color-danger)':'var(--color-primary)' }}></div>
          <div className="activity-content">
            <div className="activity-text" dangerouslySetInnerHTML={{ __html: act.text }} />
            <div className="activity-time">{act.ts ? new Date(act.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DebtPanel({ debt, today, onClose, onEdit, onPay, onSkip, onDelete, onWhatsApp }) {
  const paid     = debt.installmentList?.filter(i=>['paid','partial','skipped'].includes(i.status)).length||0;
  const total    = debt.installmentList?.length||0;
  const paidAmt  = debt.installmentList?.filter(i=>i.status==='paid'||i.status==='partial').reduce((s,i)=>s+(i.paidAmount??i.value),0)||0;
  const openAmt  = debt.installmentList?.filter(i=>!['paid','partial','skipped'].includes(i.status)).reduce((s,i)=>s+i.value,0)||0;
  const progress = total>0?(paid/total*100):0;

  function fmt(v) { return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtDate(s) { if(!s) return '—'; const[y,m,d]=s.split('-'); return `${d}/${m}/${y}`; }

  const firstPending = debt.installmentList?.find(i=>!['paid','partial','skipped'].includes(i.status));

  // Juros já pagos — usa a MESMA lógica das rows das parcelas para garantir consistência:
  // • Skipped : inst.value × taxa  (mesmo cálculo do preview na row)
  // • Partial : saldo × taxa       (mesmo cálculo do preview na row)
  // • Paid c/ penaltyRate : value − originalValue  (juros do scheduler, só nesta parcela)
  // Sem double-count: parcelas que recebem carry têm isPenalty=true, penaltyApplied=false
  const jurosJaPagos = (() => {
    const rate = parseFloat(debt.interestRate) || 0;
    let interest = 0;
    (debt.installmentList || []).forEach(inst => {
      if (inst.status === 'skipped') {
        interest += parseFloat(((inst.value || 0) * rate / 100).toFixed(2));
      } else if (inst.status === 'partial') {
        const saldo = Math.max(0, (inst.value || 0) - (inst.paidAmount || 0));
        interest += parseFloat((saldo * rate / 100).toFixed(2));
      } else if (inst.status === 'paid' && inst.penaltyApplied && inst.penaltyRate > 0) {
        interest += Math.max(0, (inst.value || 0) - (inst.originalValue || 0));
      }
    });
    return Math.max(0, parseFloat(interest.toFixed(2)));
  })();

  return (
    <>
      <div className="side-panel-header">
        <div>
          <div className="modal-title">{debt.name}</div>
          <div className="modal-subtitle">{debt.product}</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button className="btn btn-sm btn-ghost" onClick={() => onEdit(debt)}>Editar</button>
          <button className="modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="side-panel-body">
        {/* Info card */}
        <div className="settings-card" style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
            <div className="table-avatar" style={{width:48,height:48,borderRadius:'50%',background:'var(--color-primary)',fontSize:20,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff'}}>{debt.name[0]?.toUpperCase()}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:16}}>{debt.name}</div>
              {debt.phone && <div style={{fontSize:13,color:'var(--text-muted)'}}>{debt.phone}</div>}
              {debt.address && <div style={{fontSize:12,color:'var(--text-muted)'}}>{debt.address}</div>}
              <div style={{marginTop:8,display:'inline-flex',alignItems:'center',gap:6,background:'rgba(255,165,0,.08)',border:'1px solid rgba(255,165,0,.25)',borderRadius:6,padding:'4px 10px'}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f5a623" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:500,userSelect:'none'}}>Juros já pagos</span>
                <span style={{fontSize:12,fontWeight:700,color:'#f5a623'}}>{jurosJaPagos > 0 ? `R$ ${fmt(jurosJaPagos)}` : 'R$ 0,00'}</span>
              </div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div style={{background:'var(--bg-elevated)',borderRadius:'var(--radius-md)',padding:'10px 12px'}}>
              <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:2}}>Total da Dívida</div>
              <div style={{fontWeight:700,fontSize:15}}>R$ {fmt(debt.total)}</div>
            </div>
            <div style={{background:'var(--bg-elevated)',borderRadius:'var(--radius-md)',padding:'10px 12px'}}>
              <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:2}}>Parcelas</div>
              <div style={{fontWeight:700,fontSize:15}}>{paid}/{total} pagas</div>
            </div>
            <div style={{background:'var(--bg-elevated)',borderRadius:'var(--radius-md)',padding:'10px 12px'}}>
              <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:2}}>Juros a.m.</div>
              <div style={{fontWeight:700,fontSize:15}}>{debt.interestRate}%</div>
            </div>
            <div style={{background:'var(--bg-elevated)',borderRadius:'var(--radius-md)',padding:'10px 12px'}}>
              <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:2}}>Dia de venc.</div>
              <div style={{fontWeight:700,fontSize:15}}>Dia {debt.dueDay}</div>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{marginTop:14}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text-muted)',marginBottom:5}}>
              <span>Progresso</span><span>{Math.round(progress)}%</span>
            </div>
            <div style={{height:6,background:'var(--border-default)',borderRadius:99,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${progress}%`,background:'linear-gradient(90deg,var(--color-primary),var(--color-accent))',borderRadius:99,transition:'width .4s'}}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginTop:5}}>
              <span style={{color:'var(--color-success)'}}>Pago R$ {fmt(paidAmt)}</span>
              <span style={{color:'var(--color-warning)'}}>Aberto R$ {fmt(openAmt)}</span>
            </div>
          </div>
        </div>

        {/* Action buttons — 3 symmetric + delete */}
        <div style={{display:'flex',gap:6,marginBottom:16,alignItems:'stretch'}}>
          {debt.phone && firstPending && (
            <button className="btn btn-success btn-sm" onClick={() => onWhatsApp(debt, firstPending)} style={{flex:1,textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              Cobrar
            </button>
          )}
          {firstPending && (
            <button className="btn btn-primary btn-sm" onClick={() => onPay(debt, firstPending, debt.installmentList?.indexOf(firstPending))} style={{flex:1,textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              Pagamento
            </button>
          )}
          {firstPending && (
            <button className="btn btn-danger btn-sm" onClick={() => onSkip(debt, firstPending, debt.installmentList?.indexOf(firstPending))} style={{flex:1,textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              Não Pagou
            </button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(debt)} style={{flex:'0 0 auto',padding:'0 10px'}}>
            🗑
          </button>
        </div>

        {/* Installment list */}
        <div style={{fontSize:13,fontWeight:600,marginBottom:8,color:'var(--text-secondary)'}}>Parcelas</div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {debt.installmentList?.map((inst,idx) => {
            const isPaid    = inst.status==='paid';
            const isPartial = inst.status==='partial';
            const isSkipped = inst.status==='skipped';
            const isDone    = isPaid || isPartial || isSkipped;
            function fmtD(s){if(!s)return'—';const[y,m,d]=s.split('-');return`${d}/${m}/${y}`;}
            const rowBg     = isPaid ? 'rgba(0,200,83,.06)' : isPartial ? 'rgba(255,165,0,.08)' : isSkipped ? 'rgba(255,71,87,.06)' : 'var(--bg-elevated)';
            const rowBorder = isPaid ? 'rgba(0,200,83,.2)' : isPartial ? 'rgba(255,165,0,.3)' : isSkipped ? 'rgba(255,71,87,.2)' : 'var(--border-default)';
            const dotBg     = isPaid ? 'var(--color-success)' : isPartial ? '#f5a623' : isSkipped ? 'var(--color-danger)' : 'var(--border-default)';
            const dotContent = isPaid ? '✓' : isPartial ? '~' : isSkipped ? '✗' : idx+1;
            return (
              <div key={idx} style={{
                display:'flex',alignItems:'flex-start',gap:10,
                padding:'10px 12px',
                background: rowBg,
                border: `1px solid ${rowBorder}`,
                borderRadius:'var(--radius-md)',
              }}>
                <div style={{
                  width:20,height:20,borderRadius:'50%',flexShrink:0,marginTop:2,
                  background: dotBg,
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#fff',fontWeight:700
                }}>{dotContent}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600}}>
                    Parcela {idx+1}
                    {isPartial && <span style={{color:'#f5a623',marginLeft:6,fontSize:11,fontWeight:400}}>• Pagamento Parcial</span>}
                    {isSkipped && <span style={{color:'var(--color-danger)',marginLeft:6,fontSize:11,fontWeight:400}}>• Não Pagou</span>}
                  </div>
                  {isPaid && (
                    <div style={{fontSize:11,color:'var(--color-success)'}}>
                      Pago: R$ {fmt(inst.paidAmount??inst.value)}{inst.paidDate ? ` · em ${fmtD(inst.paidDate)}` : ''}
                    </div>
                  )}
                  {isPartial && (() => {
                    const saldo  = parseFloat((inst.value - (inst.paidAmount||0)).toFixed(2));
                    const juros  = parseFloat((saldo * (debt.interestRate||0) / 100).toFixed(2));
                    return (
                      <>
                        <div style={{fontSize:11,color:'var(--text-muted)'}}>valor R$ {fmt(inst.value)} — vence {fmtD(inst.dueDate)}</div>
                        <div style={{fontSize:11,color:'#f5a623',fontWeight:600}}>pago R$: {fmt(inst.paidAmount)}</div>
                        <div style={{fontSize:11,color:'var(--text-muted)'}}>saldo transferido: R$ {fmt(saldo)} <span style={{color:'#f5a623'}}>({`+ juros R$ ${fmt(juros)}`})</span></div>
                      </>
                    );
                  })()}
                  {isSkipped && (() => {
                    const juros = parseFloat((inst.value * (debt.interestRate||0) / 100).toFixed(2));
                    return (
                      <div style={{fontSize:11,color:'var(--color-danger)'}}>
                        R$ {fmt(inst.value)} transferido <span style={{color:'#f5a623'}}>({`+ juros R$ ${fmt(juros)}`})</span> para próxima
                      </div>
                    );
                  })()}
                  {!isDone && (
                    <div style={{fontSize:11,color:'var(--text-muted)'}}>Vence: {fmtD(inst.dueDate)} · R$ {fmt(inst.value)}</div>
                  )}
                </div>
                {!isDone && (
                  <div style={{display:'flex',gap:4,flexShrink:0,alignItems:'center'}}>
                    <button className="btn btn-success btn-sm" style={{fontSize:11,padding:'4px 10px',minHeight:'unset',minWidth:52}}
                      onClick={() => onPay(debt, inst, idx)}>Pagar</button>
                    <button className="btn btn-danger btn-sm" style={{fontSize:11,padding:'4px 10px',minHeight:'unset',minWidth:52}}
                      onClick={() => onSkip(debt, inst, idx)}>Não Pagou</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
