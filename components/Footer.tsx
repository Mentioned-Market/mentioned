import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-white/10 py-8">
      <div className="flex flex-col items-center gap-6">
        {/* Internal + external links */}
        <nav className="flex items-center gap-4 md:gap-6 flex-wrap justify-center">
          <Link href="/waitlist" className="text-neutral-400 hover:text-white text-sm font-medium transition-colors duration-200">
            Waitlist
          </Link>
          <span className="text-neutral-700">·</span>
          <a
            className="text-neutral-400 hover:text-white text-sm font-medium transition-colors duration-200"
            href="https://discord.gg/gsD7vf6YRx"
            target="_blank"
            rel="noopener noreferrer"
          >
            Discord
          </a>
          <span className="text-neutral-700">·</span>
          <a
            className="text-neutral-400 hover:text-white text-sm font-medium transition-colors duration-200"
            href="https://x.com/mentionedmarket"
            target="_blank"
            rel="noopener noreferrer"
          >
            Twitter
          </a>
        </nav>

        {/* Legal Disclaimer */}
        <p className="text-neutral-500 text-xs max-w-2xl leading-relaxed text-center">
          Legal Disclaimer: This is not financial advice. Invest at your own risk.
        </p>

        {/* Copyright */}
        <div className="text-neutral-600 text-xs">
          <p>© 2025 Mentioned. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

