// src/app/api/service/[code]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServiceByCode } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  if (!code || code.length !== 4 || !/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
  }

  const service = getServiceByCode(code);

  if (!service) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    serviceId: service.id,
    allowUpload: !!service.allow_upload,
    currentUsers: service.current_users,
    maxUsers: service.max_users,
  });
}
