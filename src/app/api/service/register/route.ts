// src/app/api/service/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getTokenById, markTokenUsed, createService, updateServiceConfig, isCodeInUse } from '@/lib/db';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token, code, maxUsers, allowUpload, sharePath } = body;

  if (!token || !code || code.length !== 4 || !/^\d{4}$/.test(code)) {
    return NextResponse.json(
      { error: 'Invalid request: token and 4-digit code required' },
      { status: 400 }
    );
  }

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.status !== 'unused') {
    return NextResponse.json({ error: 'Invalid or already used token' }, { status: 403 });
  }

  // Prevent duplicate codes (configuring or active)
  if (isCodeInUse(code)) {
    return NextResponse.json(
      { error: '该 4 位码已被占用，请换一个' },
      { status: 409 }
    );
  }

  const serviceId = uuidv4();
  createService(serviceId, token);
  markTokenUsed(token, serviceId);

  updateServiceConfig(serviceId, {
    code,
    max_users: maxUsers || 10,
    allow_upload: allowUpload ? 1 : 0,
    share_path: sharePath || '',
  });

  return NextResponse.json({ serviceId });
}
