// src/app/api/logs/[serviceId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTokenById, getActivityLogs, addActivityLog } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params;
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 401 });
  }

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.service_id !== serviceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const filterUser = request.nextUrl.searchParams.get('user') || undefined;
  const logs = getActivityLogs(serviceId, filterUser);

  return NextResponse.json({ logs });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params;
  const body = await request.json();
  const { token, userName, action, detail } = body;

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 401 });
  }

  const tokenRecord = getTokenById(token);
  if (!tokenRecord || tokenRecord.service_id !== serviceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (!userName || !action) {
    return NextResponse.json({ error: 'userName and action required' }, { status: 400 });
  }

  addActivityLog(serviceId, userName, action, detail || null);
  return NextResponse.json({ success: true });
}
