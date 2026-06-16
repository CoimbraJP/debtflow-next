import { NextResponse } from 'next/server';
import { connectDB }    from '@/lib/mongodb';
import { Settings }     from '@/lib/models/Settings';

// GET /api/settings
export async function GET(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const s = await Settings.findOne({ key: 'global', tenant });
  return NextResponse.json(s ? s.toJSON() : {});
}

// PUT /api/settings
export async function PUT(request) {
  await connectDB();
  const tenant = request.headers.get('x-tenant') || 'default';
  const body   = await request.json();

  const allowed = ['apiUrl', 'instance', 'apiKey', 'defaultInterest', 'msgTemplate', 'msgOverdue'];
  const update  = {};
  allowed.forEach(k => { if (body[k] !== undefined) update[k] = body[k]; });

  const s = await Settings.findOneAndUpdate(
    { key: 'global', tenant },
    { $set: update },
    { upsert: true, new: true }
  );

  return NextResponse.json(s.toJSON());
}
