'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const router = useRouter();
  const [tenants, setTenants]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null); // null | 'create' | { edit: tenant } | { del: tenant }
  const [form, setForm]         = useState({ tenant: '', name: '', password: '' });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [toast, setToast]       = useState('');

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/tenants');
    if (res.status === 403 || res.status === 401) { router.push('/'); return; }
    const data = await res.json();
    setTenants(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [router]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ tenant: '', name: '', password: '' });
    setError('');
    setModal('create');
  }

  function openEdit(t) {
    setForm({ tenant: t.tenant, name: t.name, password: '' });
    setError('');
    setModal({ edit: t });
  }

  async function handleSave() {
    setError('');
    if (!form.name.trim()) { setError('Nome é obrigatório'); return; }
    if (modal === 'create') {
      if (!form.tenant.trim()) { setError('Slug é obrigatório'); return; }
      if (!form.password.trim()) { setError('Senha é obrigatória'); return; }
    }
    setSaving(true);

    if (modal === 'create') {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: form.tenant, name: form.name, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao criar'); setSaving(false); return; }
      showToast(`Tenant "${form.name}" criado!`);
    } else {
      const body = { name: form.name };
      if (form.password.trim()) body.password = form.password;
      const res = await fetch(`/api/admin/tenants/${modal.edit._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao salvar'); setSaving(false); return; }
      showToast(`Tenant "${form.name}" atualizado!`);
    }

    setSaving(false);
    setModal(null);
    load();
  }

  async function handleDelete() {
    setSaving(true);
    const res = await fetch(`/api/admin/tenants/${modal.del._id}`, { method: 'DELETE' });
    setSaving(false);
    if (!res.ok) { showToast('Erro ao deletar'); setModal(null); return; }
    showToast(`Tenant "${modal.del.name}" removido.`);
    setModal(null);
    load();
  }

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
  }

  const fmtDate = s => {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('pt-BR');
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-default)', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg,#f5a623,#e67e22)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>DebtFlow — Admin Master</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gerenciamento de Tenants</div>
          </div>
        </div>
        <button onClick={logout} style={{ background: 'none', border: '1px solid var(--border-default)', borderRadius: 8, padding: '6px 14px', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sair
        </button>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Tenants</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>Usuários com acesso ao sistema</p>
          </div>
          <button onClick={openCreate} className="btn btn-primary" style={{ gap: 6, display: 'flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Novo Tenant
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Carregando...
          </div>
        ) : tenants.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-default)' }}>
            Nenhum tenant cadastrado. Crie o primeiro acima.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tenants.map(t => (
              <div key={t._id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,var(--color-primary),var(--color-accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: 'white' }}>
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      slug: <strong>{t.tenant}</strong> · criado em {fmtDate(t.createdAt)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openEdit(t)} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '7px 14px', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Editar
                  </button>
                  <button onClick={() => setModal({ del: t })} style={{ background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: 8, padding: '7px 14px', color: 'var(--color-danger)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal criar / editar */}
      {(modal === 'create' || modal?.edit) && (
        <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div className="modal-title">{modal === 'create' ? 'Novo Tenant' : `Editar — ${modal.edit.name}`}</div>
              <button className="modal-close" onClick={() => setModal(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              {modal === 'create' && (
                <div className="form-group">
                  <label className="form-label">Slug (identificador único)</label>
                  <input className="form-control" placeholder="ex: joao, clinica, loja2"
                    value={form.tenant} onChange={e => setForm(f => ({ ...f, tenant: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'') }))} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Somente letras minúsculas, números e _</div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Nome de Exibição</label>
                <input className="form-control" placeholder="ex: João, Clínica Central"
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">{modal === 'create' ? 'Senha' : 'Nova Senha (deixe em branco para manter)'}</label>
                <input className="form-control" type="password" placeholder="••••••••"
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              {error && <div style={{ background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--color-danger)', marginBottom: 4 }}>{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />Salvando...</> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar exclusão */}
      {modal?.del && (
        <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <div className="modal-title">Remover Tenant</div>
              <button className="modal-close" onClick={() => setModal(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
                Tem certeza que quer remover o tenant <strong style={{ color: 'var(--text-primary)' }}>{modal.del.name}</strong> (<code>{modal.del.tenant}</code>)?
              </p>
              <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 10, marginBottom: 0 }}>
                ⚠️ Os dados (dívidas) deste tenant <strong>não serão apagados</strong> do banco, apenas o acesso será removido.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)} disabled={saving}>Cancelar</button>
              <button onClick={handleDelete} disabled={saving} style={{ background: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />Removendo...</> : 'Sim, remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--color-success)', color: '#fff', padding: '10px 20px', borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
