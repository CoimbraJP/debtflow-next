'use client';

import { useState } from 'react';
import { useRouter }  from 'next/navigation';

export default function LoginPage() {
  const router   = useRouter();
  const [pw, setPw]         = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });

    setLoading(false);
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('Senha incorreta. Tente novamente.');
      setPw('');
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base)',
      padding: '20px',
    }}>
      <div style={{
        background: '#161829',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '40px',
        width: '100%',
        maxWidth: '380px',
        boxShadow: 'var(--shadow-lg), 0 0 60px rgba(108,99,255,0.1)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '56px', height: '56px',
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            borderRadius: 'var(--radius-lg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: 'var(--shadow-glow-primary)',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.5px', marginBottom: '4px' }}>DebtFlow</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Acesso ao sistema de cobranças</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label className="form-label" htmlFor="password">Senha de Acesso</label>
            <input
              id="password"
              type="password"
              className="form-control"
              placeholder="••••••••••"
              value={pw}
              onChange={e => setPw(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(255,71,87,0.1)',
              border: '1px solid rgba(255,71,87,0.25)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              fontSize: '13px',
              color: 'var(--color-danger)',
              marginBottom: '20px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px' }}
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                Verificando...
              </>
            ) : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
