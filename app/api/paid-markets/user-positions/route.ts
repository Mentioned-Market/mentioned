import { NextRequest, NextResponse } from 'next/server'
import { type Address } from '@solana/kit'
import {
  fetchAllMarketsWithFallback,
  getAssociatedTokenAddress,
  impliedYesPrice,
  estimateSellReturn,
  createRpc,
  MarketStatus,
} from '@/lib/mentionMarketUsdc'
import { getAllPaidMarketMetadata, pool } from '@/lib/db'
import { SOLANA_CLUSTER } from '@/lib/solanaConfig'

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
  estValueUsdc: string      // LMSR sell return in base units, stringified bigint
  costBasisUsdc: string     // avg-cost basis of the currently-held shares, base units
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet || wallet.length < 32) {
    return NextResponse.json({ error: 'wallet required' }, { status: 400 })
  }
  const walletAddr = wallet as Address

  const allMetadata = await getAllPaidMarketMetadata()
  const [markets, buyRows] = await Promise.all([
    fetchAllMarketsWithFallback(allMetadata.map(m => m.market_id)),
    pool.query(
      `SELECT market_id AS "marketId", word_index AS "wordIndex", direction,
              SUM(quantity) AS qty, SUM(cost) AS cost
         FROM trade_events
        WHERE trader = $1 AND is_buy = true AND cluster = $2
        GROUP BY market_id, word_index, direction`,
      [wallet, SOLANA_CLUSTER],
    ),
  ])

  const metaByMarketId = new Map(allMetadata.map(m => [m.market_id, m]))

  // Average buy cost per (marketId:wordIndex:direction) — used to value the
  // cost basis of the shares the wallet still holds (average-cost method).
  const buyAgg = new Map<string, { qty: number; cost: number }>()
  for (const r of buyRows.rows) {
    buyAgg.set(`${r.marketId}:${r.wordIndex}:${r.direction}`, {
      qty: parseFloat(r.qty), cost: parseFloat(r.cost),
    })
  }

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
        estValueUsdc: '0',
        costBasisUsdc: '0',
      })
    }
    const pos = posMap.get(key)!
    const amount = amounts.get(ref.ata) ?? 0n
    if (ref.side === 'YES') pos.yesShares = amount.toString()
    else pos.noShares = amount.toString()
  }

  // Compute accurate LMSR sell-return for each position
  const DUST = 10_000n
  for (const pos of posMap.values()) {
    const mkt = mktMap.get(BigInt(pos.marketId))!
    const word = mkt.words[pos.wordIndex]
    const yes = BigInt(pos.yesShares)
    const no  = BigInt(pos.noShares)
    try {
      if (word.outcome !== null) {
        // Resolved: the winning side redeems 1:1 ($1/share); the LOSING side is
        // worthless and must value at $0 (it can't be redeemed or sold).
        const yesVal = word.outcome === true ? yes : 0n
        const noVal  = word.outcome === false ? no : 0n
        pos.estValueUsdc = (yesVal + noVal).toString()
      } else {
        const yesRet = yes >= DUST ? estimateSellReturn(word, mkt.liquidityParamB, 'YES', yes) : 0n
        const noRet  = no  >= DUST ? estimateSellReturn(word, mkt.liquidityParamB, 'NO',  no)  : 0n
        pos.estValueUsdc = (yesRet + noRet).toString()
      }
    } catch {
      pos.estValueUsdc = '0'
    }

    // Cost basis of the currently-held shares (average buy cost × held shares).
    const yesBuy = buyAgg.get(`${pos.marketId}:${pos.wordIndex}:0`)
    const noBuy  = buyAgg.get(`${pos.marketId}:${pos.wordIndex}:1`)
    let basis = 0
    if (yesBuy && yesBuy.qty > 0) basis += (yesBuy.cost / yesBuy.qty) * Number(yes)
    if (noBuy  && noBuy.qty  > 0) basis += (noBuy.cost  / noBuy.qty)  * Number(no)
    pos.costBasisUsdc = Math.round(basis).toString()
  }

  // 10_000 base units = 0.01 shares — filter out dust left after selling
  const positions = Array.from(posMap.values()).filter(
    p => BigInt(p.yesShares) >= DUST || BigInt(p.noShares) >= DUST
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
