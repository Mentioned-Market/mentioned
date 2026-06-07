import { NextRequest, NextResponse } from 'next/server'
import { type Address } from '@solana/kit'
import {
  USDC_MINT,
  RPC_URL,
  getAssociatedTokenAddress,
  fetchAllMarketsWithFallback,
  estimateSellReturn,
} from '@/lib/mentionMarketUsdc'
import { getAllPaidMarketMetadata } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readU64LE(buf: Buffer, offset: number): bigint {
  const lo = BigInt(buf.readUInt32LE(offset))
  const hi = BigInt(buf.readUInt32LE(offset + 4))
  return (hi << 32n) | lo
}

async function getTokenBalance(ata: Address): Promise<bigint> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTokenAccountBalance',
      params: [ata, { commitment: 'confirmed' }],
    }),
  })
  const json = await res.json()
  const amount = json.result?.value?.amount
  return amount ? BigInt(amount) : 0n
}

const DUST = 10_000n

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet || wallet.length < 32) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 })
  }
  const walletAddr = wallet as Address

  // USDC cash balance + portfolio value in parallel
  const [usdcAta, allMetadata] = await Promise.all([
    getAssociatedTokenAddress(USDC_MINT, walletAddr),
    getAllPaidMarketMetadata(),
  ])
  const markets = await fetchAllMarketsWithFallback(allMetadata.map(m => m.market_id))

  // Batch-fetch all position ATAs + the USDC wallet ATA
  type AtaRef = { marketId: bigint; wordIndex: number; side: 'YES' | 'NO'; ata: Address }
  const ataRefPromises = markets.flatMap(({ account: mkt }) =>
    mkt.words.slice(0, mkt.numWords).flatMap((word, wi) => [
      getAssociatedTokenAddress(word.yesMint, walletAddr).then(ata => ({
        marketId: mkt.marketId, wordIndex: wi, side: 'YES' as const, ata,
      })),
      getAssociatedTokenAddress(word.noMint, walletAddr).then(ata => ({
        marketId: mkt.marketId, wordIndex: wi, side: 'NO' as const, ata,
      })),
    ])
  )
  const ataRefs: AtaRef[] = await Promise.all(ataRefPromises)

  // Batch getMultipleAccounts for all ATAs + USDC wallet ATA
  const allAddresses = [usdcAta, ...ataRefs.map(r => r.ata)]
  const BATCH = 100
  const amounts = new Map<string, bigint>()

  for (let i = 0; i < allAddresses.length; i += BATCH) {
    const batch = allAddresses.slice(i, i + BATCH)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await fetch(RPC_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getMultipleAccounts',
        params: [batch, { encoding: 'base64' }],
      }),
    })
    const json = await res.json()
    for (let j = 0; j < batch.length; j++) {
      const acct = json.result?.value?.[j]
      if (!acct?.data) { amounts.set(batch[j], 0n); continue }
      const raw = Buffer.from(acct.data[0], 'base64')
      amounts.set(batch[j], raw.length >= 72 ? readU64LE(raw, 64) : 0n)
    }
  }

  const usdcBalance = amounts.get(usdcAta) ?? 0n

  // Compute portfolio value (sum of LMSR sell returns for non-dust positions)
  const mktMap = new Map(markets.map(({ account }) => [account.marketId, account]))
  type PosKey = `${string}:${number}`
  const posMap = new Map<PosKey, { yes: bigint; no: bigint; marketId: bigint; wordIndex: number }>()

  for (const ref of ataRefs) {
    const key: PosKey = `${ref.marketId}:${ref.wordIndex}`
    if (!posMap.has(key)) posMap.set(key, { yes: 0n, no: 0n, marketId: ref.marketId, wordIndex: ref.wordIndex })
    const entry = posMap.get(key)!
    const amount = amounts.get(ref.ata) ?? 0n
    if (ref.side === 'YES') entry.yes = amount
    else entry.no = amount
  }

  let portfolioValue = 0n
  for (const { yes, no, marketId, wordIndex } of posMap.values()) {
    if (yes < DUST && no < DUST) continue
    const mkt = mktMap.get(marketId)
    if (!mkt) continue
    const word = mkt.words[wordIndex]
    try {
      if (yes >= DUST) portfolioValue += estimateSellReturn(word, mkt.liquidityParamB, 'YES', yes)
      if (no >= DUST)  portfolioValue += estimateSellReturn(word, mkt.liquidityParamB, 'NO',  no)
    } catch { /* skip */ }
  }

  return NextResponse.json({
    usdcBalance: usdcBalance.toString(),
    portfolioValue: portfolioValue.toString(),
  })
}
