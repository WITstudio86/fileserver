// src/app/api/service/close/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, setServiceClosed } from '@/lib/db';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token } = body;

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || !tokenRecord.service_id) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  setServiceClosed(tokenRecord.service_id);

  return NextResponse.json({ success: true });
}
