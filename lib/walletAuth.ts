import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { PrivyClient } from '@privy-io/server-auth'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

// ── Config ──────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET || ''
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60 // 7 days

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || ''

let _privyClient: PrivyClient | null = null
function getPrivyClient(): PrivyClient {
  if (!_privyClient) {
    _privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
  }
  return _privyClient
}

// ── Validation ──────────────────────────────────────────────

/** Solana addresses are 32-44 character base58 strings. */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function isValidSolanaAddress(addr: string): boolean {
  return BASE58_RE.test(addr)
}

// ── Session tokens (HMAC-signed) ────────────────────────────

/**
 * Create a session token for a verified wallet.
 * Format: `<wallet>.<expiry_unix>.<hmac_base64url>`
 * Solana addresses are base58 (no dots), so splitting on '.' is safe.
 */
export function createSessionToken(wallet: string): string {
  if (!isValidSolanaAddress(wallet)) throw new Error('Invalid wallet address')
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S
  const payload = `${wallet}.${exp}`
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url')
  return `${payload}.${sig}`
}

/** Returns the verified wallet address, or null if token is invalid/expired. */
export function verifySessionToken(token: string): string | null {
  const lastDot = token.lastIndexOf('.')
  if (lastDot === -1) return null

  const payload = token.slice(0, lastDot)
  const sig = token.slice(lastDot + 1)

  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url')

  // Constant-time comparison
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null

  // Check expiry
  const dotIdx = payload.lastIndexOf('.')
  if (dotIdx === -1) return null
  const exp = parseInt(payload.slice(dotIdx + 1), 10)
  if (isNaN(exp) || Date.now() / 1000 > exp) return null

  return payload.slice(0, dotIdx) // wallet
}

export const SESSION_MAX_AGE = SESSION_MAX_AGE_S

// ── Privy verification ──────────────────────────────────────

/** Verify a Privy access token and return the user's Solana wallet address. */
export async function verifyPrivyToken(token: string): Promise<string | null> {
  try {
    const privy = getPrivyClient()
    const claims = await privy.verifyAuthToken(token)
    const user = await privy.getUser(claims.userId)

    // Find the user's Solana wallet (embedded wallets created on login)
    const solanaWallet = user.linkedAccounts.find(
      (a: any) => a.type === 'wallet' && a.chainType === 'solana',
    )
    return (solanaWallet as any)?.address ?? null
  } catch {
    return null
  }
}

// ── Phantom sign-in verification ────────────────────────────

const SIGN_IN_PREFIX = 'Sign in to Mentioned'
const MAX_SIGN_IN_AGE_S = 300 // 5 minutes

/**
 * Verify a Phantom sign-in: Ed25519 signature over a timestamped message.
 * Message format:
 *   Sign in to Mentioned
 *   Timestamp: <unix_seconds>
 */
export function verifyPhantomSignIn(
  wallet: string,
  signatureBase64: string,
  message: string,
): boolean {
  try {
    // Validate message format
    const lines = message.split('\n')
    if (lines[0] !== SIGN_IN_PREFIX) return false

    const tsLine = lines[1]
    if (!tsLine || !tsLine.startsWith('Timestamp: ')) return false
    const ts = parseInt(tsLine.slice('Timestamp: '.length), 10)
    if (isNaN(ts)) return false

    // Reject stale messages
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - ts) > MAX_SIGN_IN_AGE_S) return false

    // Verify Ed25519 signature
    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = Buffer.from(signatureBase64, 'base64')
    const publicKeyBytes = bs58.decode(wallet)

    if (signatureBytes.length !== 64) return false
    if (publicKeyBytes.length !== 32) return false

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
  } catch {
    return false
  }
}

// ── Request helpers ─────────────────────────────────────────

/** Extract the verified wallet from the session cookie. Returns null if unauthenticated. */
export function getVerifiedWallet(req: NextRequest): string | null {
  const cookie = req.cookies.get('session')?.value
  if (!cookie) return null
  return verifySessionToken(cookie)
}

// ── Discord OAuth state signing (1.3) ───────────────────────

const DISCORD_STATE_SECRET = process.env.DISCORD_STATE_SECRET || SESSION_SECRET

/** Create an HMAC-signed Discord OAuth state parameter. */
export function signDiscordState(wallet: string): string {
  const ts = Math.floor(Date.now() / 1000)
  const data = JSON.stringify({ wallet, ts })
  const sig = crypto
    .createHmac('sha256', DISCORD_STATE_SECRET)
    .update(data)
    .digest('hex')
  return Buffer.from(JSON.stringify({ wallet, ts, sig })).toString('base64url')
}

/** Verify and extract wallet from a signed Discord OAuth state. Returns null if invalid. */
export function verifyDiscordState(state: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    const { wallet, ts, sig } = parsed
    if (!wallet || !ts || !sig) return null

    // Verify HMAC
    const data = JSON.stringify({ wallet, ts })
    const expected = crypto
      .createHmac('sha256', DISCORD_STATE_SECRET)
      .update(data)
      .digest('hex')

    if (sig.length !== expected.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null

    // Reject stale state (10 minute window)
    const now = Math.floor(Date.now() / 1000)
    if (now - ts > 600) return null

    return wallet
  } catch {
    return null
  }
}
