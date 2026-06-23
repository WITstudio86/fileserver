// src/app/api/token/status/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, expireUnusedTokens } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  expireUnusedTokens();

  const token = getTokenById(id);
  if (!token) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: token.id,
    status: token.status,
    serviceId: token.service_id,
    expiresAt: token.expires_at,
  });
}
