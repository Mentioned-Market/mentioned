import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ admin: false })
  return NextResponse.json({ admin: isAdmin(wallet) })
}
