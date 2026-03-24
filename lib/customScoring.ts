import {
  insertPointEvent,
  getWordSentimentAtLockTime,
  getAllMarketPredictions,
  getCustomMarketWords,
} from './db'
import type { WordSentiment } from './db'
import {
  getSentimentBand,
  getPointsForPrediction,
  INCORRECT_PENALTY,
  PARTICIPATION_BONUS,
  PARTICIPATION_THRESHOLD,
} from './customMarketUtils'

export interface WordScoreBreakdown {
  wordId: number
  word: string
  prediction: boolean
  resolvedOutcome: boolean
  correct: boolean
  band: string
  points: number
}

export interface ScoringResult {
  wallet: string
  pointsAwarded: number
  breakdown: WordScoreBreakdown[]
  bonus: boolean
  rawTotal: number
}

/**
 * Score a single user for a resolved custom market.
 * Uses sentiment frozen at lock time for band classification.
 */
export function scoreUserPredictions(
  predictions: { word_id: number; prediction: boolean }[],
  words: { id: number; word: string; resolved_outcome: boolean | null }[],
  sentiment: WordSentiment[],
): Omit<ScoringResult, 'wallet'> {
  const sentimentMap = new Map(sentiment.map(s => [s.word_id, s]))
  const wordMap = new Map(words.map(w => [w.id, w]))

  const breakdown: WordScoreBreakdown[] = []
  let total = 0

  for (const pred of predictions) {
    const word = wordMap.get(pred.word_id)
    const sent = sentimentMap.get(pred.word_id)
    if (!word || word.resolved_outcome === null) continue

    const correct = pred.prediction === word.resolved_outcome
    const yesPct = sent?.yes_pct ?? 50
    const points = correct
      ? getPointsForPrediction(yesPct, pred.prediction)
      : -INCORRECT_PENALTY

    total += points
    breakdown.push({
      wordId: pred.word_id,
      word: word.word,
      prediction: pred.prediction,
      resolvedOutcome: word.resolved_outcome,
      correct,
      band: getSentimentBand(yesPct).band,
      points,
    })
  }

  const bonus = predictions.length >= PARTICIPATION_THRESHOLD
  if (bonus) total += PARTICIPATION_BONUS

  const rawTotal = total
  const pointsAwarded = Math.max(0, total)

  return { pointsAwarded, breakdown, bonus, rawTotal }
}

/**
 * Score all participants and award points for a resolved custom market.
 */
export async function resolveAndScoreMarket(marketId: number): Promise<ScoringResult[]> {
  const [predictionsByWallet, words, sentiment] = await Promise.all([
    getAllMarketPredictions(marketId),
    getCustomMarketWords(marketId),
    getWordSentimentAtLockTime(marketId),
  ])

  const results: ScoringResult[] = []

  for (const [wallet, predictions] of predictionsByWallet) {
    const scoring = scoreUserPredictions(predictions, words, sentiment)
    const result: ScoringResult = { wallet, ...scoring }
    results.push(result)

    if (result.pointsAwarded > 0) {
      await insertPointEvent(
        wallet,
        'custom_market_win',
        result.pointsAwarded,
        `custom_${marketId}`,
        { marketId, breakdown: result.breakdown, bonus: result.bonus },
      )
    }
  }

  return results
}

/**
 * Preview potential points for a user's current predictions (before resolution).
 * Used client-side and server-side for the "potential points" display.
 */
export function calculatePotentialPoints(
  userPredictions: { wordId: number; prediction: boolean }[],
  sentiment: { wordId: number; yesPct: number }[],
): { perWord: { wordId: number; ifCorrect: number; band: string }[]; bestCase: number; bonus: boolean } {
  const sentimentMap = new Map(sentiment.map(s => [s.wordId, s]))

  const perWord = userPredictions.map(pred => {
    const sent = sentimentMap.get(pred.wordId)
    const yesPct = sent?.yesPct ?? 50
    const band = getSentimentBand(yesPct)
    const ifCorrect = pred.prediction ? band.yesPoints : band.noPoints
    return { wordId: pred.wordId, ifCorrect, band: band.band }
  })

  const bonus = userPredictions.length >= PARTICIPATION_THRESHOLD
  const bestCase = perWord.reduce((sum, w) => sum + w.ifCorrect, 0) + (bonus ? PARTICIPATION_BONUS : 0)

  return { perWord, bestCase, bonus }
}
