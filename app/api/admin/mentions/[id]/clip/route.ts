import { NextRequest, NextResponse } from 'next/server'
import { getMentionClipKey } from '@/lib/db'
import { isAdmin } from '@/lib/adminAuth'
import { getVerifiedWallet } from '@/lib/walletAuth'
import { presignClipUrl, isClipStoreConfigured } from '@/lib/clipStore'

// Serve a mention's saved audio clip. Admin-gated. The mention id is resolved
// server-side to its stored clip_key, then 302-redirected to a short-lived
// presigned URL — the key is never taken from the client, so there's no path
// traversal or arbitrary-object access. <audio src="…/clip"> carries the
// same-origin session cookie and follows the redirect for playback.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const wallet = getVerifiedWallet(req)
  if (!wallet) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isAdmin(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (!isClipStoreConfigured()) {
    return NextResponse.json({ error: 'Clip storage not configured' }, { status: 503 })
  }

  const { id } = await params
  const mentionId = parseInt(id, 10)
  if (!Number.isFinite(mentionId) || mentionId <= 0) {
    return NextResponse.json({ error: 'Invalid mention id' }, { status: 400 })
  }

  const clipKey = await getMentionClipKey(mentionId)
  if (!clipKey) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 })
  }

  const url = await presignClipUrl(clipKey)
  if (!url) {
    return NextResponse.json({ error: 'Failed to sign clip URL' }, { status: 500 })
  }
  // Don't let the browser cache the redirect — the presigned URL is short-lived
  // and should be re-minted on each playback rather than reused from cache.
  const res = NextResponse.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
