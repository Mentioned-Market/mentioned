import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Community Rules',
  description: 'Fair-play rules for trading on Mentioned free markets.',
}

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold mb-2">Community Rules</h1>
        <p className="text-neutral-500 text-sm mb-10">Last updated: April 16, 2026</p>

        <div className="space-y-8 text-neutral-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Scope</h2>
            <p>
              These rules apply to Mentioned&apos;s free markets, including the play-token
              leaderboards, team competitions, and any prizes awarded for activity on those
              markets. They exist to keep the markets fair and the leaderboards honest, and
              they apply equally to everyone.
            </p>
            <p className="mt-2">
              If a behaviour isn&apos;t explicitly listed below but is clearly an attempt to game
              the system, we&apos;ll treat it the same as if it were. Mentioned reserves the
              right to update these rules as new patterns emerge.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Core Principles</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>One person, one identity.</strong> Each user trades from one wallet,
                linked to one Discord account. Operating multiple wallets is not permitted.
              </li>
              <li>
                <strong>Compete with skill, not coordination.</strong> Win by being right about
                outcomes, not by moving tokens between accounts you control or accounts
                you&apos;re working with.
              </li>
              <li>
                <strong>Trade like a human.</strong> Mentioned is built for people watching
                live events. Automated trading is not permitted.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Multi-Account Use</h2>
            <p>Operating more than one wallet to:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>stack contributions to your team&apos;s leaderboard score</li>
              <li>refer your own additional wallets for points or achievements</li>
              <li>transfer play tokens between wallets via opposing trades</li>
              <li>bypass per-wallet limits or Discord gates</li>
            </ul>
            <p className="mt-3">
              This includes wallets you control yourself, wallets you operate for someone else,
              and wallets you&apos;ve recruited or paid to play for your benefit.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Coordinated Trading and Collusion</h2>
            <p>Working with one or more other users to:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>take coordinated opposite positions across markets to transfer tokens between accounts</li>
              <li>pump or dump prices in concert</li>
              <li>engineer outcomes where one account consistently wins at the expense of another</li>
              <li>share signals with the intent of manipulating market resolution</li>
            </ul>
            <p className="mt-3">
              Two people independently trading the same market is fine. Two or more people
              repeatedly trading in coordinated opposite directions, where one side
              systematically loses tokens to the other, is not.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Wash Trading and Bots</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                Repeatedly opening and closing the same position to inflate trade count,
                points, or leaderboard standing.
              </li>
              <li>Buying both sides of a market in rapid succession.</li>
              <li>Running scripts, bots, or any automated trading software.</li>
              <li>
                Sub-second buy/sell reversals at scale, identical share quantities across many
                round-trips, or trade patterns that continue without normal human breaks.
              </li>
            </ul>
            <p className="mt-3">
              Changing your mind, exiting a losing trade, or taking profit is fine.
              Machine-speed in-and-out behaviour is not.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Team Competitions</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Every member of a team must be a separate real human.</li>
              <li>
                Stacking a team with wallets controlled by one or two people will disqualify
                the entire team.
              </li>
              <li>
                If we find collusion involving a team, every member forfeits prizes — not just
                the wallet that initiated it.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Insider Use and Front-Running</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                Trading on non-public information about market resolution — for example, if
                you are the producer of the event and know what is coming — is not permitted.
              </li>
              <li>
                Coordinating with stream producers, on-air talent, or moderators to engineer a
                specific resolution outcome is not permitted.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Detection and Enforcement</h2>
            <p>
              We run automated systems that flag suspicious behaviour for human review. Every
              flagged case is reviewed before any action is taken.
            </p>
            <p className="mt-3">When a violation is confirmed:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>First-time minor case</strong> — warning, with any disputed points
                reset for the affected period.
              </li>
              <li>
                <strong>Clear violation</strong> — wallet locked from trading, current prizes
                forfeited.
              </li>
              <li>
                <strong>Severe or repeat violation</strong> — permanent lock, earned points
                wiped.
              </li>
              <li>
                <strong>Coordinated collusion</strong> — every wallet involved is locked,
                regardless of who initiated it.
              </li>
            </ul>
            <p className="mt-3">
              A locked wallet retains its Discord link, so the same person cannot create a
              fresh wallet to re-enter.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Appeals</h2>
            <p>
              If you believe your wallet was locked in error, reach out in our{' '}
              <a
                href="https://discord.gg/gsD7vf6YRx"
                target="_blank"
                rel="noopener noreferrer"
                className="text-apple-blue hover:underline"
              >
                Discord server
              </a>{' '}
              within 14 days. Include your wallet address and a brief explanation. We&apos;ll
              review and respond within 5 business days. Appeal decisions are final.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Changes to These Rules</h2>
            <p>
              We may update these rules as the platform evolves. Changes take effect on
              publication, and significant updates will be announced in Discord and on the
              platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Contact</h2>
            <p>
              For questions about these rules, reach us in our{' '}
              <a
                href="https://discord.gg/gsD7vf6YRx"
                target="_blank"
                rel="noopener noreferrer"
                className="text-apple-blue hover:underline"
              >
                Discord server
              </a>{' '}
              or on{' '}
              <a
                href="https://x.com/mentionedmarket"
                target="_blank"
                rel="noopener noreferrer"
                className="text-apple-blue hover:underline"
              >
                Twitter
              </a>
              .
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
