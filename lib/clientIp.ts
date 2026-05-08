import { NextRequest } from 'next/server'
import { isIP } from 'net'

/**
 * Resolve the real client IP behind Cloudflare → Railway.
 *
 * In production, Cloudflare sets `cf-connecting-ip` with the originating
 * client IP. In staging (no Cloudflare) and local dev, falls back to
 * standard proxy headers; if none are present (or the value isn't a valid
 * IP), returns null so the caller can store NULL safely.
 *
 * The IP is validated via `net.isIP()` because it gets passed straight into
 * a Postgres `INET` column — an unvalidated header value (e.g. malformed
 * proxy chain or spoofed garbage) would throw a cast error and break the
 * INSERT.
 *
 * Used by user_visit_logs and any other audit-log capture for multi-account
 * detection — never expose the value to the client.
 */
export function getClientIp(req: NextRequest): string | null {
  const raw =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  if (!raw) return null
  return isIP(raw) ? raw : null
}
