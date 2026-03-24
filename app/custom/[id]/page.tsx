'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import EventChat from '@/components/EventChat'
import { useWallet } from '@/contexts/WalletContext'
import {
  getSentimentBand,
  getPointsForPrediction,
  INCORRECT_PENALTY,
  PARTICIPATION_BONUS,
  PARTICIPATION_THRESHOLD,
  getStatusLabel,
} from '@/lib/customMarketUtils'

// ── Types ──────────────────────────────────────────────

interface CustomMarket {
  id: number
  title: string
  description: string | null
  cover_image_url: string | null
  stream_url: string | null
  status: string
  lock_time: string | null
  created_at: string
}

interface MarketWord {
  id: number
  market_id: number
  word: string
  resolved_outcome: boolean | null
}

interface Sentiment {
  word_id: number
  word: string
  yes_count: number
  no_count: number
  total: number
  yes_pct: number
  resolved_outcome: boolean | null
}

interface Prediction {
  word_id: number
  prediction: boolean
}

// ── Helpers ────────────────────────────────────────────

function toEmbedUrl(url: string): string {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const twitchChannel = url.match(/twitch\.tv\/([^/?]+)/i)
  if (twitchChannel) return `https://player.twitch.tv/?channel=${twitchChannel[1]}&parent=${hostname}&muted=true`
  const twitchVod = url.match(/twitch\.tv\/videos\/(\d+)/i)
  if (twitchVod) return `https://player.twitch.tv/?video=v${twitchVod[1]}&parent=${hostname}&muted=true`
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/)
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1`
  const ytLive = url.match(/youtube\.com\/live\/([^?&]+)/)
  if (ytLive) return `https://www.youtube.com/embed/${ytLive[1]}?autoplay=1&mute=1`
  return url
}

function timeUntil(isoTime: string): string {
  const diff = new Date(isoTime).getTime() - Date.now()
  if (diff <= 0) return 'Locked'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

// ── Word Card Component ────────────────────────────────

function WordCard({
  word,
  sentiment,
  userPrediction,
  isOpen,
  onPredict,
  submitting,
}: {
  word: MarketWord
  sentiment: Sentiment | undefined
  userPrediction: boolean | undefined
  isOpen: boolean
  onPredict: (wordId: number, prediction: boolean) => void
  submitting: number | null
}) {
  const yesPct = sentiment?.yes_pct ?? 50
  const noPct = 100 - yesPct
  const band = getSentimentBand(yesPct)
  const isResolved = word.resolved_outcome !== null
  const isSubmitting = submitting === word.id

  const yesPoints = getPointsForPrediction(yesPct, true)
  const noPoints = getPointsForPrediction(yesPct, false)

  return (
    <div className={`rounded-xl border transition-colors ${
      isResolved
        ? word.resolved_outcome
          ? 'border-apple-green/20 bg-apple-green/5'
          : 'border-apple-red/20 bg-apple-red/5'
        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
    }`}>
      <div className="p-4">
        {/* Word title + resolution badge */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">{word.word}</span>
          {isResolved && (
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
              word.resolved_outcome ? 'bg-apple-green/20 text-apple-green' : 'bg-apple-red/20 text-apple-red'
            }`}>
              {word.resolved_outcome ? 'YES' : 'NO'}
            </span>
          )}
          {!isResolved && userPrediction !== undefined && (
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
              userPrediction ? 'bg-apple-green/20 text-apple-green' : 'bg-apple-red/20 text-apple-red'
            }`}>
              Your pick: {userPrediction ? 'YES' : 'NO'}
            </span>
          )}
        </div>

        {/* Sentiment bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-1">
            <span>YES {yesPct}%</span>
            <span>{noPct}% NO</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-white/5 flex">
            <div
              className="bg-apple-green/60 transition-all duration-300"
              style={{ width: `${yesPct}%` }}
            />
            <div
              className="bg-apple-red/60 transition-all duration-300"
              style={{ width: `${noPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-neutral-600 mt-1">
            <span>{sentiment?.total ?? 0} vote{(sentiment?.total ?? 0) !== 1 ? 's' : ''}</span>
            <span className="text-neutral-500">
              +{yesPoints} / +{noPoints} pts
            </span>
          </div>
        </div>

        {/* YES / NO buttons */}
        {isOpen && !isResolved && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onPredict(word.id, true)}
              disabled={isSubmitting}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                userPrediction === true
                  ? 'bg-apple-green text-white'
                  : 'bg-white/5 text-neutral-300 hover:bg-apple-green/20 hover:text-apple-green'
              } disabled:opacity-50`}
            >
              {isSubmitting ? '...' : 'YES'}
            </button>
            <button
              onClick={() => onPredict(word.id, false)}
              disabled={isSubmitting}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                userPrediction === false
                  ? 'bg-apple-red text-white'
                  : 'bg-white/5 text-neutral-300 hover:bg-apple-red/20 hover:text-apple-red'
              } disabled:opacity-50`}
            >
              {isSubmitting ? '...' : 'NO'}
            </button>
          </div>
        )}

        {/* Resolved result for user */}
        {isResolved && userPrediction !== undefined && (
          <div className={`text-xs font-medium text-center py-1.5 rounded-lg ${
            userPrediction === word.resolved_outcome
              ? 'bg-apple-green/10 text-apple-green'
              : 'bg-apple-red/10 text-apple-red'
          }`}>
            {userPrediction === word.resolved_outcome ? 'Correct!' : 'Incorrect'}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Potential Points Panel ─────────────────────────────

function PotentialPointsPanel({
  predictions,
  sentiment,
  words,
  marketStatus,
}: {
  predictions: Prediction[]
  sentiment: Sentiment[]
  words: MarketWord[]
  marketStatus: string
}) {
  if (predictions.length === 0) {
    return (
      <div className="glass rounded-xl p-4">
        <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
          Potential Points
        </h3>
        <p className="text-neutral-500 text-sm">
          Make predictions to see your potential points
        </p>
      </div>
    )
  }

  const sentimentMap = new Map(sentiment.map(s => [s.word_id, s]))
  const wordMap = new Map(words.map(w => [w.id, w]))

  let total = 0
  const isResolved = marketStatus === 'resolved'

  const breakdown = predictions.map(pred => {
    const sent = sentimentMap.get(pred.word_id)
    const word = wordMap.get(pred.word_id)
    const yesPct = sent?.yes_pct ?? 50
    const ifCorrect = getPointsForPrediction(yesPct, pred.prediction)
    const band = getSentimentBand(yesPct)

    if (isResolved && word?.resolved_outcome !== null && word?.resolved_outcome !== undefined) {
      const correct = pred.prediction === word.resolved_outcome
      const points = correct ? ifCorrect : -INCORRECT_PENALTY
      total += points
      return { wordId: pred.word_id, word: word?.word, points, correct, band: band.band }
    }

    total += ifCorrect
    return { wordId: pred.word_id, word: word?.word, points: ifCorrect, correct: null, band: band.band }
  })

  const bonus = predictions.length >= PARTICIPATION_THRESHOLD
  if (bonus) total += PARTICIPATION_BONUS
  const displayTotal = Math.max(0, total)

  return (
    <div className="glass rounded-xl p-4">
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
        {isResolved ? 'Points Earned' : 'Potential Points'}
      </h3>

      <div className="text-2xl font-bold text-white mb-3">
        {displayTotal} <span className="text-sm text-neutral-500 font-normal">pts</span>
      </div>

      <div className="space-y-1.5 mb-3">
        {breakdown.map(b => (
          <div key={b.wordId} className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 truncate mr-2">{b.word}</span>
            <span className={
              b.correct === true ? 'text-apple-green font-medium' :
              b.correct === false ? 'text-apple-red font-medium' :
              'text-neutral-300'
            }>
              {b.points > 0 ? '+' : ''}{b.points}
              <span className="text-neutral-600 ml-1">({b.band})</span>
            </span>
          </div>
        ))}
      </div>

      {bonus && (
        <div className="text-xs text-apple-blue flex items-center justify-between border-t border-white/5 pt-2">
          <span>4+ predictions bonus</span>
          <span>+{PARTICIPATION_BONUS}</span>
        </div>
      )}

      {!isResolved && (
        <p className="text-[10px] text-neutral-600 mt-2">
          Points shown assume all predictions are correct. Wrong answers deduct {INCORRECT_PENALTY} pts each. Floor: 0.
        </p>
      )}
    </div>
  )
}

// ── Sentiment Chart ────────────────────────────────────

function SentimentChart({ sentiment }: { sentiment: Sentiment[] }) {
  if (sentiment.length === 0) return null

  return (
    <div className="glass rounded-xl p-4">
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
        Crowd Sentiment
      </h3>
      <div className="space-y-2">
        {sentiment.map(s => (
          <div key={s.word_id}>
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span className="text-neutral-300 truncate mr-2">{s.word}</span>
              <span className="text-neutral-500 tabular-nums">{s.yes_pct}% YES</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden bg-white/5 flex">
              <div
                className="bg-apple-green/50 transition-all duration-300"
                style={{ width: `${s.yes_pct}%` }}
              />
              <div
                className="bg-apple-red/50 transition-all duration-300"
                style={{ width: `${100 - s.yes_pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────

export default function CustomMarketPage() {
  const params = useParams()
  const id = params.id as string
  const marketId = parseInt(id, 10)
  const { connected, connect, publicKey } = useWallet()

  const [market, setMarket] = useState<CustomMarket | null>(null)
  const [words, setWords] = useState<MarketWord[]>([])
  const [sentiment, setSentiment] = useState<Sentiment[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [predictionCount, setPredictionCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<number | null>(null)
  const [streamHidden, setStreamHidden] = useState(false)

  // Fetch market data
  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}`)
      if (!res.ok) throw new Error('Market not found')
      const data = await res.json()
      setMarket(data.market)
      setWords(data.words)
      setSentiment(data.sentiment)
      setPredictionCount(data.predictionCount)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [marketId])

  // Fetch user predictions
  const fetchPredictions = useCallback(async () => {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/custom/${marketId}/predictions?wallet=${publicKey}`)
      const data = await res.json()
      setPredictions(data.predictions || [])
    } catch { /* ignore */ }
  }, [marketId, publicKey])

  // Fetch sentiment only (for polling)
  const fetchSentiment = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom/${marketId}/sentiment`)
      const data = await res.json()
      setSentiment(data.sentiment)
    } catch { /* ignore */ }
  }, [marketId])

  useEffect(() => { fetchMarket() }, [fetchMarket])
  useEffect(() => { fetchPredictions() }, [fetchPredictions])

  // Poll sentiment when market is open
  useEffect(() => {
    if (!market || market.status !== 'open') return
    const interval = setInterval(fetchSentiment, 10000)
    return () => clearInterval(interval)
  }, [market?.status, fetchSentiment])

  async function handlePredict(wordId: number, prediction: boolean) {
    if (!publicKey || !market) return
    setSubmitting(wordId)

    // Optimistic update
    setPredictions(prev => {
      const existing = prev.findIndex(p => p.word_id === wordId)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = { ...updated[existing], prediction }
        return updated
      }
      return [...prev, { word_id: wordId, prediction }]
    })

    try {
      const res = await fetch(`/api/custom/${marketId}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey, wordId, prediction }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      // Refresh sentiment after prediction
      fetchSentiment()
    } catch (err: any) {
      // Revert optimistic update on error
      fetchPredictions()
      console.error('Prediction error:', err.message)
    } finally {
      setSubmitting(null)
    }
  }

  const isOpen = market?.status === 'open' && (!market.lock_time || new Date(market.lock_time) > new Date())
  const predictionMap = new Map(predictions.map(p => [p.word_id, p.prediction]))
  const streamEmbedUrl = market?.stream_url ? toEmbedUrl(market.stream_url) : null

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
          <Header />
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !market) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
          <Header />
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-neutral-400 mb-4">{error || 'Market not found'}</p>
            <a href="/markets" className="text-apple-blue hover:underline text-sm">Back to markets</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-10 lg:px-20">
        <Header />

        <main className="py-4 md:py-6 animate-fade-in">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            {market.cover_image_url && (
              <img
                src={market.cover_image_url}
                alt={market.title}
                className="w-16 h-16 md:w-20 md:h-20 rounded-xl object-cover"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-apple-green/20 text-apple-green">
                  FREE
                </span>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                  market.status === 'open' ? 'bg-green-500/20 text-green-400' :
                  market.status === 'locked' ? 'bg-orange-500/20 text-orange-400' :
                  market.status === 'resolved' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-white/10 text-neutral-400'
                }`}>
                  {getStatusLabel(market.status)}
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-bold">{market.title}</h1>
              {market.description && (
                <p className="text-neutral-400 text-sm mt-1">{market.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
                <span>{words.length} words</span>
                <span>{predictionCount} predictor{predictionCount !== 1 ? 's' : ''}</span>
                {market.lock_time && isOpen && (
                  <span>Locks in {timeUntil(market.lock_time)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Stream embed */}
          {streamEmbedUrl && !streamHidden && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Live Stream</span>
                <button
                  onClick={() => setStreamHidden(true)}
                  className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
                >
                  Hide
                </button>
              </div>
              <div className="relative w-full rounded-xl overflow-hidden border border-white/5" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  src={streamEmbedUrl}
                  className="absolute inset-0 w-full h-full"
                  allowFullScreen
                  allow="autoplay; encrypted-media"
                />
              </div>
            </div>
          )}

          {/* Main content: two-column layout */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left column: Words + Chart */}
            <div className="flex-1 min-w-0 space-y-6">
              {/* Connect wallet prompt */}
              {!connected && isOpen && (
                <div className="glass rounded-xl p-4 text-center">
                  <p className="text-neutral-400 text-sm mb-3">Connect your wallet to make predictions</p>
                  <button
                    onClick={connect}
                    className="px-5 py-2.5 bg-apple-blue text-white text-sm font-semibold rounded-lg hover:bg-apple-blue/80 transition-colors"
                  >
                    Connect Wallet
                  </button>
                </div>
              )}

              {/* Word grid */}
              <div>
                <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                  Predictions {isOpen ? '' : market.status === 'locked' ? '(Locked)' : market.status === 'resolved' ? '(Resolved)' : ''}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {words.map(word => (
                    <WordCard
                      key={word.id}
                      word={word}
                      sentiment={sentiment.find(s => s.word_id === word.id)}
                      userPrediction={predictionMap.get(word.id)}
                      isOpen={isOpen && connected}
                      onPredict={handlePredict}
                      submitting={submitting}
                    />
                  ))}
                </div>
              </div>

              {/* Sentiment chart */}
              <SentimentChart sentiment={sentiment} />
            </div>

            {/* Right column: Points + Chat */}
            <div className="w-full lg:w-80 xl:w-96 space-y-4 flex-shrink-0">
              <PotentialPointsPanel
                predictions={predictions}
                sentiment={sentiment}
                words={words}
                marketStatus={market.status}
              />

              <div className="h-[500px]">
                <EventChat
                  eventId={`custom_${marketId}`}
                  marketIds={[]}
                />
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  )
}
