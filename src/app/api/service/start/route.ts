// src/app/api/service/start/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, getServiceById, setServiceActive } from '@/lib/db';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token } = body;

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.status !== 'used' || !tokenRecord.service_id) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const service = getServiceById(tokenRecord.service_id);
  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 });
  }

  setServiceActive(service.id);

  return NextResponse.json({ success: true, serviceId: service.id });
}
