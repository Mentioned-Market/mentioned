import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Mentioned terms of service — rules and conditions for using the platform.',
}

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-neutral-500 text-sm mb-10">Last updated: April 6, 2026</p>

        <div className="space-y-8 text-neutral-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the Mentioned platform at mentioned.market (the &quot;Platform&quot;), you agree
              to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, do not
              use the Platform. We reserve the right to modify these Terms at any time, and your continued use
              of the Platform constitutes acceptance of any changes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Eligibility</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>You must be at least 18 years of age to use the Platform.</li>
              <li>You must have the legal capacity to enter into a binding agreement.</li>
              <li>You are responsible for ensuring that your use of the Platform complies with all laws and regulations applicable to you in your jurisdiction.</li>
              <li>The Platform may not be available in all jurisdictions. It is your responsibility to determine whether your use is lawful in your location.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Account and Wallet</h2>
            <p>
              The Platform uses Solana wallet-based authentication. Your wallet public key serves as your identity.
              You are solely responsible for maintaining the security of your wallet, private keys, and seed phrases.
              We never have access to your private keys. Any transactions signed with your wallet are considered
              authorized by you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Platform Services</h2>
            <p>The Platform provides access to three types of prediction markets:</p>

            <h3 className="text-white font-medium mt-4 mb-2">4.1 Polymarket (Jupiter Integration)</h3>
            <p>
              Markets powered by Jupiter Prediction API where users trade with real USDC on the Solana blockchain.
              These markets are subject to Jupiter&apos;s own terms and conditions in addition to these Terms.
            </p>

            <h3 className="text-white font-medium mt-4 mb-2">4.2 On-Chain Mention Markets</h3>
            <p>
              Custom LMSR automated market maker (AMM) markets deployed on the Solana blockchain. Trading involves
              real SOL and on-chain transactions.
            </p>

            <h3 className="text-white font-medium mt-4 mb-2">4.3 Free Markets</h3>
            <p>
              Virtual markets using play tokens with no real monetary value. Profits earned in free markets convert
              to platform points. Discord account linking is required to participate in free markets.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Trading and Financial Risks</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>No financial advice.</strong> Nothing on the Platform constitutes financial, investment,
                legal, or tax advice. All trading decisions are your own.
              </li>
              <li>
                <strong>Risk of loss.</strong> Trading in prediction markets involves substantial risk. You may
                lose some or all of the funds you commit to trades. Only trade with funds you can afford to lose.
              </li>
              <li>
                <strong>Blockchain risks.</strong> Transactions on the Solana blockchain are irreversible. Smart
                contract bugs, network congestion, or other technical issues may result in loss of funds.
              </li>
              <li>
                <strong>No guarantees.</strong> We do not guarantee the accuracy, reliability, or timeliness of
                market resolution, price data, or any information displayed on the Platform.
              </li>
              <li>
                <strong>Market resolution.</strong> Markets are resolved by platform administrators based on
                publicly verifiable outcomes. Resolution decisions are final.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. User Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Manipulate markets through wash trading, spoofing, or other deceptive practices</li>
              <li>Use bots, scripts, or automated tools to interact with the Platform without authorization</li>
              <li>Exploit bugs, vulnerabilities, or errors in the Platform or smart contracts</li>
              <li>Post abusive, threatening, harassing, or illegal content in chat</li>
              <li>Impersonate other users or misrepresent your identity</li>
              <li>Attempt to gain unauthorized access to the Platform&apos;s systems or other users&apos; accounts</li>
              <li>Use the Platform for money laundering, terrorist financing, or other illegal activities</li>
              <li>Circumvent rate limits, access controls, or other security measures</li>
            </ul>
            <p className="mt-2">
              We reserve the right to restrict or terminate access for any user who violates these rules, at our
              sole discretion.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Points and Achievements</h2>
            <p>
              Platform points and achievements are virtual rewards with no monetary value. They cannot be
              exchanged, transferred, or redeemed for cash or cryptocurrency. We reserve the right to modify
              the points system, achievement criteria, or leaderboard rules at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Intellectual Property</h2>
            <p>
              All content, design, code, and branding on the Platform are owned by Mentioned or its licensors.
              You may not copy, modify, distribute, or create derivative works from any part of the Platform
              without our prior written consent.
            </p>
            <p className="mt-2">
              By posting content (such as chat messages or usernames), you grant Mentioned a non-exclusive,
              royalty-free license to display that content on the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Third-Party Services</h2>
            <p>
              The Platform integrates with third-party services including Jupiter Prediction API, Solana
              blockchain, Helius, Discord, and others. Your use of these services is subject to their respective
              terms and privacy policies. We are not responsible for the availability, accuracy, or conduct of
              any third-party services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Disclaimers</h2>
            <p>
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
              EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED,
              ERROR-FREE, OR SECURE.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, MENTIONED AND ITS TEAM SHALL NOT BE LIABLE FOR ANY
              INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO
              LOSS OF PROFITS, FUNDS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE PLATFORM, TRADING
              ACTIVITIES, SMART CONTRACT INTERACTIONS, OR ANY OTHER CAUSE RELATED TO THESE TERMS.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">12. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Mentioned and its team from any claims, damages, losses,
              or expenses (including legal fees) arising from your use of the Platform, violation of these Terms,
              or infringement of any third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">13. Termination</h2>
            <p>
              We may suspend or terminate your access to the Platform at any time, for any reason, without notice.
              Upon termination, your right to use the Platform ceases immediately. Provisions that by their nature
              should survive termination (including disclaimers, limitation of liability, and indemnification)
              will remain in effect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">14. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the United States.
              Any disputes arising from these Terms or your use of the Platform shall be resolved through binding
              arbitration, except where prohibited by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">15. Severability</h2>
            <p>
              If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions
              shall continue in full force and effect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">16. Contact</h2>
            <p>
              For questions about these Terms, reach out through our{' '}
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
