import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Mentioned privacy policy — how we collect, use, and protect your information.',
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-neutral-500 text-sm mb-10">Last updated: April 6, 2026</p>

        <div className="space-y-8 text-neutral-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Introduction</h2>
            <p>
              Mentioned (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the mentioned.market website and
              related services (collectively, the &quot;Platform&quot;). This Privacy Policy explains how we collect,
              use, disclose, and safeguard your information when you use the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Information We Collect</h2>

            <h3 className="text-white font-medium mt-4 mb-2">2.1 Information You Provide</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Wallet address.</strong> Your Solana wallet public key, used as your identity on the Platform.</li>
              <li><strong>Profile information.</strong> Username and profile emoji you choose to set.</li>
              <li><strong>Discord account.</strong> If you link your Discord account to participate in free markets, we store your Discord user ID and username.</li>
              <li><strong>Chat messages.</strong> Messages you post in global chat or event-specific chat rooms.</li>
              <li><strong>Bug reports.</strong> Information you voluntarily submit through the bug report feature.</li>
            </ul>

            <h3 className="text-white font-medium mt-4 mb-2">2.2 Information Collected Automatically</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Transaction data.</strong> Records of trades, positions, and orders placed on the Platform, including on-chain transaction signatures.</li>
              <li><strong>Usage data.</strong> Pages visited, features used, and interactions with the Platform.</li>
              <li><strong>Device information.</strong> Browser type, operating system, and screen resolution for optimizing your experience.</li>
              <li><strong>IP address.</strong> Collected for rate limiting, abuse prevention, and forwarded to third-party APIs as required.</li>
            </ul>

            <h3 className="text-white font-medium mt-4 mb-2">2.3 Blockchain Data</h3>
            <p>
              Transactions on the Solana blockchain are public by nature. Your wallet address and on-chain trading
              activity are visible to anyone and are not subject to this Privacy Policy. We index publicly available
              on-chain data to display your trading history and positions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Provide, operate, and maintain the Platform</li>
              <li>Process trades and manage your positions</li>
              <li>Display your profile, chat messages, and leaderboard rankings</li>
              <li>Calculate and award points and achievements</li>
              <li>Prevent fraud, abuse, and enforce rate limits</li>
              <li>Respond to bug reports and support requests</li>
              <li>Improve the Platform based on usage patterns</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. How We Share Your Information</h2>
            <p>We do not sell your personal information. We may share information in the following circumstances:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Public profile data.</strong> Your username, profile emoji, chat messages, trading activity, and leaderboard position are visible to other users.</li>
              <li><strong>Third-party APIs.</strong> We forward your IP address to Jupiter Prediction API as required by their terms. We use Helius for on-chain data indexing.</li>
              <li><strong>Discord.</strong> If you link your Discord account, we exchange information with Discord as necessary for authentication.</li>
              <li><strong>Legal requirements.</strong> We may disclose information if required by law, regulation, or legal process.</li>
              <li><strong>Infrastructure providers.</strong> Our hosting provider (Railway) and CDN (Cloudflare) may process data as part of providing their services.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Data Storage and Security</h2>
            <p>
              Your data is stored in a PostgreSQL database hosted on Railway. We implement reasonable security
              measures including parameterized queries to prevent SQL injection, rate limiting on API endpoints,
              and admin-only access controls. However, no method of electronic transmission or storage is 100%
              secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Cookies</h2>
            <p>
              We use minimal cookies solely for functionality purposes, such as remembering your cookie consent
              preference and tutorial completion status. We do not use tracking cookies or third-party analytics
              cookies. For more details, see our{' '}
              <a href="/cookies" className="text-apple-blue hover:underline">Cookie Policy</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your personal information</li>
              <li>Object to or restrict processing of your information</li>
              <li>Data portability</li>
            </ul>
            <p className="mt-2">
              To exercise these rights, contact us via our Discord server. Note that on-chain data cannot be
              deleted as it is part of the public blockchain record.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active or as needed to provide services. Chat
              messages, trade records, and leaderboard data are retained indefinitely to maintain platform
              integrity. You may request deletion of your profile information (username, emoji) at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Children&apos;s Privacy</h2>
            <p>
              The Platform is not intended for individuals under the age of 18. We do not knowingly collect
              information from children. If you believe a child has provided us with personal information,
              please contact us and we will take steps to delete it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. International Users</h2>
            <p>
              The Platform is operated from the United States. If you access the Platform from outside the
              United States, your information may be transferred to and processed in the United States or
              other jurisdictions where our infrastructure providers operate. By using the Platform, you
              consent to this transfer.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify users of material changes
              by updating the &quot;Last updated&quot; date at the top of this page. Your continued use of the
              Platform after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">12. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please reach out through our{' '}
              <a href="https://discord.gg/gsD7vf6YRx" target="_blank" rel="noopener noreferrer" className="text-apple-blue hover:underline">
                Discord server
              </a>{' '}
              or contact us on{' '}
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
