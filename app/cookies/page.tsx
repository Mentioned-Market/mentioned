import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description: 'Mentioned cookie policy — what cookies we use and why.',
}

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold mb-2">Cookie Policy</h1>
        <p className="text-neutral-500 text-sm mb-10">Last updated: April 6, 2026</p>

        <div className="space-y-8 text-neutral-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. What Are Cookies</h2>
            <p>
              Cookies are small text files stored on your device by your web browser when you visit a website.
              They are widely used to make websites function properly, remember your preferences, and provide
              information to site operators.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Our Approach</h2>
            <p>
              Mentioned uses a minimal set of cookies. We do not use third-party tracking cookies, advertising
              cookies, or analytics cookies. All cookies we set are strictly functional — they exist to make
              the Platform work correctly and remember your preferences.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Cookies We Use</h2>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-4 text-white font-medium">Cookie</th>
                    <th className="py-2 pr-4 text-white font-medium">Purpose</th>
                    <th className="py-2 pr-4 text-white font-medium">Duration</th>
                    <th className="py-2 text-white font-medium">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs">mentioned_cookie_consent</td>
                    <td className="py-2 pr-4">Remembers whether you accepted or declined cookies</td>
                    <td className="py-2 pr-4">1 year</td>
                    <td className="py-2">Functional</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs">mentioned_tutorial_seen</td>
                    <td className="py-2 pr-4">Prevents the tutorial from showing again after dismissal</td>
                    <td className="py-2 pr-4">1 year</td>
                    <td className="py-2">Functional</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Local Storage</h2>
            <p>
              In addition to cookies, we may use your browser&apos;s local storage to persist preferences
              and UI state (such as chat panel position or collapsed states). Local storage data stays on
              your device and is not transmitted to our servers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Third-Party Cookies</h2>
            <p>
              We do not set third-party cookies. However, third-party services we integrate with (such as
              Cloudflare for CDN and security) may set their own cookies as part of their standard operation.
              These are governed by the respective third party&apos;s cookie policies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Managing Cookies</h2>
            <p>
              You can control cookies through your browser settings. Most browsers allow you to block or delete
              cookies. However, disabling cookies may affect the functionality of the Platform. You can also
              change your cookie preference using the cookie banner that appears on your first visit.
            </p>
            <p className="mt-2">Common browser cookie settings:</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li><strong>Chrome:</strong> Settings &gt; Privacy and security &gt; Cookies and other site data</li>
              <li><strong>Firefox:</strong> Settings &gt; Privacy &amp; Security &gt; Cookies and Site Data</li>
              <li><strong>Safari:</strong> Preferences &gt; Privacy &gt; Manage Website Data</li>
              <li><strong>Edge:</strong> Settings &gt; Cookies and site permissions</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Changes to This Policy</h2>
            <p>
              We may update this Cookie Policy if we introduce new cookies or change how we use existing ones.
              Changes will be reflected in the &quot;Last updated&quot; date above.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Contact</h2>
            <p>
              Questions about our use of cookies? Reach out on{' '}
              <a href="https://discord.gg/gsD7vf6YRx" target="_blank" rel="noopener noreferrer" className="text-apple-blue hover:underline">
                Discord
              </a>{' '}
              or{' '}
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
