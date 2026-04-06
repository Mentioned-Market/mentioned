import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: 'Mentioned risk disclosure and legal disclaimer.',
}

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold mb-2">Disclaimer</h1>
        <p className="text-neutral-500 text-sm mb-10">Last updated: April 6, 2026</p>

        <div className="space-y-8 text-neutral-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. No Financial Advice</h2>
            <p>
              The information and services provided on the Mentioned platform (mentioned.market) are for
              informational and entertainment purposes only. Nothing on this Platform constitutes financial,
              investment, legal, or tax advice. You should consult a qualified professional before making
              any financial decisions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Risk of Loss</h2>
            <p>
              Trading in prediction markets involves substantial risk of loss and is not suitable for everyone.
              The value of positions can fluctuate significantly, and you may lose some or all of your invested
              capital. Past performance of any market, trader, or strategy is not indicative of future results.
            </p>
            <p className="mt-2 font-medium text-white">
              Only trade with funds you can afford to lose entirely.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Blockchain and Smart Contract Risks</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Irreversibility.</strong> Transactions on the Solana blockchain are final and cannot
                be reversed. Sending funds to the wrong address or signing a malicious transaction will result
                in permanent loss.
              </li>
              <li>
                <strong>Smart contract risk.</strong> Our on-chain markets use smart contracts that, despite
                testing, may contain bugs or vulnerabilities. Interacting with smart contracts carries inherent
                risk of fund loss.
              </li>
              <li>
                <strong>Network risk.</strong> The Solana network may experience congestion, outages, or
                degraded performance that could affect your ability to trade or claim positions in a timely
                manner.
              </li>
              <li>
                <strong>Wallet security.</strong> You are solely responsible for the security of your wallet
                and private keys. We have no ability to recover lost keys or reverse unauthorized transactions.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Market Resolution</h2>
            <p>
              Markets on the Platform are resolved by administrators based on publicly verifiable information.
              While we strive for accuracy and fairness, resolution decisions are final and may be subject to
              interpretation. We are not liable for disputes arising from market resolution outcomes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Third-Party Services</h2>
            <p>
              The Platform integrates with third-party services including Jupiter Prediction API, Solana
              blockchain validators, Helius, Discord, and others. We do not control these services and are
              not responsible for their availability, accuracy, security, or any losses resulting from their
              use or failure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. No Warranty</h2>
            <p>
              The Platform is provided &quot;as is&quot; without warranty of any kind. We do not guarantee that the
              Platform will be available, uninterrupted, error-free, or secure. We do not guarantee the
              accuracy or completeness of any data, prices, or information displayed on the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Regulatory Compliance</h2>
            <p>
              Prediction markets may be subject to varying regulations depending on your jurisdiction. It is
              your sole responsibility to determine whether your use of the Platform is lawful in your
              location. We make no representation that the Platform is appropriate or available for use in
              any particular jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, Mentioned and its team shall not be liable
              for any direct, indirect, incidental, special, consequential, or punitive damages arising from
              your use of the Platform, including but not limited to trading losses, smart contract failures,
              network issues, or unauthorized access to your wallet.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Free Markets</h2>
            <p>
              Free markets on the Platform use virtual play tokens with no real monetary value. Points earned
              from free market activity cannot be exchanged for cash, cryptocurrency, or any other form of
              value. Free markets are provided for entertainment and educational purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Contact</h2>
            <p>
              If you have questions about this disclaimer, please contact us through our{' '}
              <a href="https://discord.gg/gsD7vf6YRx" target="_blank" rel="noopener noreferrer" className="text-apple-blue hover:underline">
                Discord server
              </a>{' '}
              or on{' '}
              <a href="https://x.com/mentionedmarket" target="_blank" rel="noopener noreferrer" className="text-apple-blue hover:underline">
                Twitter
              </a>.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
