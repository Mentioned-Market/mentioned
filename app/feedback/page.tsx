'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useWallet } from '@/contexts/WalletContext'

type SadIfGone = 'very_disappointed' | 'somewhat_disappointed' | 'not_disappointed' | ''
type RealMoney = 'definitely' | 'maybe' | 'not_likely' | ''

interface RadioGroupProps {
  name: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

function RadioGroup({ name, options, value, onChange }: RadioGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
            value === opt.value
              ? 'border-[#9dfad7] bg-[#9dfad7]/10 text-white'
              : 'border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/10'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          <span
            className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
              value === opt.value ? 'border-[#9dfad7]' : 'border-white/30'
            }`}
          >
            {value === opt.value && (
              <span className="w-2 h-2 rounded-full bg-[#9dfad7]" />
            )}
          </span>
          <span className="text-sm">{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

export default function FeedbackPage() {
  const { publicKey, authenticated } = useWallet()

  const [honestThoughts, setHonestThoughts] = useState('')
  const [sadIfGone, setSadIfGone] = useState<SadIfGone>('')
  const [improvements, setImprovements] = useState('')
  const [realMoney, setRealMoney] = useState<RealMoney>('')
  const [extra, setExtra] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [pointsAwarded, setPointsAwarded] = useState(0)
  const [error, setError] = useState('')
  const [checkingStatus, setCheckingStatus] = useState(true)

  useEffect(() => {
    if (!authenticated) {
      setCheckingStatus(false)
      return
    }
    fetch('/api/feedback')
      .then((r) => r.json())
      .then((d) => {
        if (d.submitted) setSubmitted(true)
      })
      .catch(() => {})
      .finally(() => setCheckingStatus(false))
  }, [authenticated])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!authenticated) {
      setError('Connect your wallet to submit feedback')
      return
    }

    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ honestThoughts, sadIfGone, improvements, realMoney, extra }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.alreadySubmitted) {
          setSubmitted(true)
          return
        }
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      setPointsAwarded(data.pointsAwarded ?? 50)
      setSubmitted(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const MIN_LENGTH = 20

  const canSubmit =
    honestThoughts.trim().length >= MIN_LENGTH &&
    sadIfGone !== '' &&
    improvements.trim().length >= MIN_LENGTH &&
    realMoney !== ''

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Header />

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-10 flex flex-col gap-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Share Your Feedback</h1>
          <p className="text-white/60 text-sm">
            Help us build a better Mentioned. Takes 2 minutes.
          </p>
        </div>

        {/* Points banner */}
        <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#9dfad7]/30 bg-[#9dfad7]/5">
          <span className="text-[#9dfad7] font-bold text-lg">+100</span>
          <span className="text-white/70 text-sm">points for completing this form</span>
        </div>

        {checkingStatus ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#9dfad7] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : submitted ? (
          <div className="rounded-xl border border-[#9dfad7]/30 bg-[#9dfad7]/5 p-8 text-center flex flex-col gap-3">
            <div className="text-4xl">✓</div>
            <h2 className="text-lg font-semibold">Thanks for your feedback!</h2>
            <p className="text-white/60 text-sm">
              Your input helps us shape Mentioned into something people genuinely love.
            </p>
            {pointsAwarded > 0 && (
              <p className="text-[#9dfad7] font-semibold text-sm mt-1">
                +{pointsAwarded} points added to your account
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">

            {/* Q1: Honest thoughts */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-3">
              <label className="text-sm font-semibold text-white">
                What are your honest thoughts on Mentioned?{' '}
                <span className="text-[#9dfad7]">*</span>
              </label>
              <p className="text-white/40 text-xs -mt-1">
                What do you like? What feels off? Be as candid as you like.
              </p>
              <textarea
                value={honestThoughts}
                onChange={(e) => setHonestThoughts(e.target.value)}
                placeholder="e.g. I love the prediction markets but the UI feels cluttered on mobile..."
                rows={4}
                maxLength={1000}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-[#9dfad7]/50"
              />
              <div className="flex justify-between items-center">
                {honestThoughts.trim().length > 0 && honestThoughts.trim().length < MIN_LENGTH ? (
                  <p className="text-amber-400 text-xs">{MIN_LENGTH - honestThoughts.trim().length} more characters needed</p>
                ) : (
                  <span />
                )}
                <p className="text-white/30 text-xs">{honestThoughts.length}/1000</p>
              </div>
            </div>

            {/* Q2: Sad if gone */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-3">
              <label className="text-sm font-semibold text-white">
                How would you feel if Mentioned was no longer available?{' '}
                <span className="text-[#9dfad7]">*</span>
              </label>
              <RadioGroup
                name="sadIfGone"
                value={sadIfGone}
                onChange={(v) => setSadIfGone(v as SadIfGone)}
                options={[
                  { value: 'very_disappointed', label: 'Very disappointed — I use it regularly and it would be a real loss' },
                  { value: 'somewhat_disappointed', label: 'Somewhat disappointed — I like it but could find alternatives' },
                  { value: 'not_disappointed', label: 'Not disappointed — it hasn\'t clicked for me yet' },
                ]}
              />
            </div>

            {/* Q3: Improvements */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-3">
              <label className="text-sm font-semibold text-white">
                What would you most like to see improved?{' '}
                <span className="text-[#9dfad7]">*</span>
              </label>
              <p className="text-white/40 text-xs -mt-1">
                Features, UX, performance, anything goes.
              </p>
              <textarea
                value={improvements}
                onChange={(e) => setImprovements(e.target.value)}
                placeholder="e.g. Faster market resolution, more market categories, better mobile layout..."
                rows={4}
                maxLength={1000}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-[#9dfad7]/50"
              />
              <div className="flex justify-between items-center">
                {improvements.trim().length > 0 && improvements.trim().length < MIN_LENGTH ? (
                  <p className="text-amber-400 text-xs">{MIN_LENGTH - improvements.trim().length} more characters needed</p>
                ) : (
                  <span />
                )}
                <p className="text-white/30 text-xs">{improvements.length}/1000</p>
              </div>
            </div>

            {/* Q4: Real money */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-3">
              <label className="text-sm font-semibold text-white">
                Would you consider trading with real money on Mentioned?{' '}
                <span className="text-[#9dfad7]">*</span>
              </label>
              <p className="text-white/40 text-xs -mt-1">
                We currently have free markets with play tokens and Polymarket integration.
              </p>
              <RadioGroup
                name="realMoney"
                value={realMoney}
                onChange={(v) => setRealMoney(v as RealMoney)}
                options={[
                  { value: 'definitely', label: 'Definitely — I\'d put real money on markets here' },
                  { value: 'maybe', label: 'Maybe — depends on the market selection and fees' },
                  { value: 'not_likely', label: 'Not likely — I prefer the free markets for now' },
                ]}
              />
            </div>

            {/* Q5: Extra (optional) */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-3">
              <label className="text-sm font-semibold text-white">
                Anything else you want to share? <span className="text-white/40 font-normal">(optional)</span>
              </label>
              <textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="Feature ideas, bug reports, words of encouragement..."
                rows={3}
                maxLength={1000}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-[#9dfad7]/50"
              />
              <p className="text-white/30 text-xs text-right">{extra.length}/1000</p>
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            {!authenticated && (
              <p className="text-white/50 text-sm text-center">
                Connect your wallet to submit and earn points
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit || submitting || !authenticated}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#9dfad7] text-black hover:brightness-110 active:scale-[0.98]"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Submitting...
                </span>
              ) : (
                'Submit Feedback — Earn 100 Points'
              )}
            </button>
          </form>
        )}
      </main>

      <Footer />
    </div>
  )
}
