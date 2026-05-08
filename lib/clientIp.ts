import { NextRequest } from 'next/server'

/**
 * Resolve the real client IP behind Cloudflare → Railway.
 *
 * Cloudflare sets `cf-connecting-ip` with the originating client IP. We fall
 * back to standard proxy headers in case Cloudflare is bypassed for some path
 * (or for local dev). Returns null when no header is present.
 *
 * Used by user_visit_logs and any other audit-log capture for multi-account
 * detection — never expose the value to the client.
 */
export function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  )
}
