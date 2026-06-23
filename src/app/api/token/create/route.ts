// src/app/api/token/create/route.ts
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createToken } from '@/lib/db';

export async function POST() {
  const tokenId = uuidv4();
  const expireHours = parseInt(process.env.TOKEN_EXPIRE_HOURS || '12', 10);
  createToken(tokenId, expireHours);

  return NextResponse.json({ token: tokenId, expiresInHours: expireHours });
}
