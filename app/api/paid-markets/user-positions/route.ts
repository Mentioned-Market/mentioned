import { NextRequest, NextResponse } from 'next/server'
import { type Address } from '@solana/kit'
import {
  fetchAllMarkets,
  getAssociatedTokenAddress,
  impliedYesPrice,
  createRpc,
  MarketStatus,
} from '@/lib/mentionMarketUsdc'
import { getAllPaidMarketMetadata } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readU64LE(buf: Buffer, offset: number): bigint {
  const lo = BigInt(buf.readUInt32LE(offset))
  const hi = BigInt(buf.readUInt32LE(offset + 4))
  return (hi << 32n) | lo
}

export interface OnchainPosition {
  marketId: string
  marketTitle: string
  marketStatus: number
  coverImageUrl: string | null
  wordIndex: number
  wordLabel: string
  yesShares: string   // base units (6 dp), stringified bigint
  noShares: string
  yesPrice: number    // 0-1 implied price
  noPrice: number
  outcome: boolean | null   // true = YES won, false = NO won, null = unresolved
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet || wallet.length < 32) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 })
  }
  const walletAddr = wallet as Address

  const [markets, allMetadata] = await Promise.all([
    fetchAllMarkets(),
    getAllPaidMarketMetadata(),
  ])

  const metaByMarketId = new Map(allMetadata.map(m => [m.market_id, m]))

  // Collect all ATA addresses we need to check in one batch
  type AtaRef = {
    marketId: bigint
    wordIndex: number
    side: 'YES' | 'NO'
    ata: Address
  }

  const ataRefPromises = markets.flatMap(({ account: mkt }) =>
    mkt.words.flatMap((word, wi) => [
      getAssociatedTokenAddress(word.yesMint, walletAddr).then(ata => ({
        marketId: mkt.marketId, wordIndex: wi, side: 'YES' as const, ata,
      })),
      getAssociatedTokenAddress(word.noMint, walletAddr).then(ata => ({
        marketId: mkt.marketId, wordIndex: wi, side: 'NO' as const, ata,
      })),
    ])
  )
  const ataRefs: AtaRef[] = await Promise.all(ataRefPromises)

  // Batch fetch all ATAs via getMultipleAccounts (max 100 per call)
  const rpc = createRpc()
  const BATCH = 100
  const amounts = new Map<string, bigint>()

  for (let i = 0; i < ataRefs.length; i += BATCH) {
    const batch = ataRefs.slice(i, i + BATCH)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (rpc as any)
      .getMultipleAccounts(batch.map(r => r.ata), { encoding: 'base64' })
      .send()
    for (let j = 0; j < batch.length; j++) {
      const acct = result.value[j]
      if (!acct?.data) {
        amounts.set(batch[j].ata, 0n)
        continue
      }
      // SPL token account: amount u64LE at offset 64
      const raw = Buffer.from(acct.data[0], 'base64')
      amounts.set(batch[j].ata, raw.length >= 72 ? readU64LE(raw, 64) : 0n)
    }
  }

  // Build position map keyed by "marketId:wordIndex"
  const posMap = new Map<string, OnchainPosition>()
  const mktMap = new Map(markets.map(({ account }) => [account.marketId, account]))

  for (const ref of ataRefs) {
    const key = `${ref.marketId}:${ref.wordIndex}`
    if (!posMap.has(key)) {
      const mkt = mktMap.get(ref.marketId)!
      const word = mkt.words[ref.wordIndex]
      const meta = metaByMarketId.get(mkt.marketId.toString())
      const yesPrice = impliedYesPrice(word, mkt.liquidityParamB)
      posMap.set(key, {
        marketId: mkt.marketId.toString(),
        marketTitle: meta?.title ?? mkt.label ?? `Market #${mkt.marketId}`,
        marketStatus: mkt.status,
        coverImageUrl: meta?.cover_image_url ?? null,
        wordIndex: ref.wordIndex,
        wordLabel: word.label,
        yesShares: '0',
        noShares: '0',
        yesPrice,
        noPrice: 1 - yesPrice,
        outcome: word.outcome,
      })
    }
    const pos = posMap.get(key)!
    const amount = amounts.get(ref.ata) ?? 0n
    if (ref.side === 'YES') pos.yesShares = amount.toString()
    else pos.noShares = amount.toString()
  }

  const positions = Array.from(posMap.values()).filter(
    p => BigInt(p.yesShares) > 0n || BigInt(p.noShares) > 0n
  )

  // Sort: active markets first, then resolved; within each group by market id desc
  positions.sort((a, b) => {
    const aResolved = a.marketStatus === MarketStatus.Resolved ? 1 : 0
    const bResolved = b.marketStatus === MarketStatus.Resolved ? 1 : 0
    if (aResolved !== bResolved) return aResolved - bResolved
    return Number(BigInt(b.marketId) - BigInt(a.marketId))
  })

  return NextResponse.json({ positions })
}
