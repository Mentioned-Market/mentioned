import { NextRequest, NextResponse } from 'next/server'
import { getPriceHistory, getPriceHistoryForMarket, getCustomMarketWords } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const marketId = parseInt(id, 10)
  if (isNaN(marketId)) {
    return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 })
  }

  const wordIdParam = req.nextUrl.searchParams.get('word_id')

  if (wordIdParam) {
    const wordId = parseInt(wordIdParam, 10)
    if (isNaN(wordId)) {
      return NextResponse.json({ error: 'Invalid word_id' }, { status: 400 })
    }
    const history = await getPriceHistory(wordId)
    const words = await getCustomMarketWords(marketId)
    const word = words.find(w => w.id === wordId)
    return NextResponse.json({
      words: [{
        word_id: wordId,
        word: word?.word ?? '',
        history: history.map(h => ({ t: h.recorded_at, yes: parseFloat(h.yes_price), no: parseFloat(h.no_price) })),
      }],
    })
  }

  // All words for the market
  const [words, allHistory] = await Promise.all([
    getCustomMarketWords(marketId),
    getPriceHistoryForMarket(marketId),
  ])

  const historyByWord = new Map<number, { t: string; yes: number; no: number }[]>()
  for (const h of allHistory) {
    const arr = historyByWord.get(h.word_id) || []
    arr.push({ t: h.recorded_at, yes: parseFloat(h.yes_price), no: parseFloat(h.no_price) })
    historyByWord.set(h.word_id, arr)
  }

  return NextResponse.json({
    words: words.map(w => ({
      word_id: w.id,
      word: w.word,
      history: historyByWord.get(w.id) || [],
    })),
  })
}
