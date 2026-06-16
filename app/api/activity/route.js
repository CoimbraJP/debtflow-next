import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Activity }     from '@/lib/models/Activity';

// GET /api/activity
export async function GET(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const acts = await Activity.find({ tenant }).sort({ createdAt: -1 }).limit(200);
  return NextResponse.json(acts.map(a => a.toJSON()));
}

// DELETE /api/activity — Limpar histórico do tenant
export async function DELETE(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  await Activity.deleteMany({ tenant });
  return NextResponse.json({ ok: true });
}
