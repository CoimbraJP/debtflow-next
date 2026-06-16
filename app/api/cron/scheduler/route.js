import { NextResponse } from 'next/server';
import { runScheduler } from '@/lib/scheduler';

// GET /api/cron/scheduler — Chamado pelo Vercel Cron (toda hora)
// Protegido pelo CRON_SECRET via middleware
export async function GET() {
  try {
    const result = await runScheduler();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[Cron] Erro no scheduler:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/cron/scheduler — Execução manual (autenticada via cookie)
export async function POST() {
  try {
    const result = await runScheduler();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[Cron] Erro no scheduler (manual):', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
