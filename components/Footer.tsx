import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-white/10 py-8">
      <div className="flex flex-col items-center gap-6">
        {/* Social links */}
        <nav className="flex items-center gap-4 md:gap-6 flex-wrap justify-center">
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

        {/* Legal links */}
        <nav className="flex items-center gap-4 md:gap-6 flex-wrap justify-center">
          <Link
            href="/terms"
            className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors duration-200"
          >
            Terms of Service
          </Link>
          <span className="text-neutral-700">·</span>
          <Link
            href="/privacy"
            className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors duration-200"
          >
            Privacy Policy
          </Link>
          <span className="text-neutral-700">·</span>
          <Link
            href="/cookies"
            className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors duration-200"
          >
            Cookie Policy
          </Link>
          <span className="text-neutral-700">·</span>
          <Link
            href="/disclaimer"
            className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors duration-200"
          >
            Disclaimer
          </Link>
        </nav>

        {/* Legal Disclaimer */}
        <p className="text-neutral-500 text-xs max-w-2xl leading-relaxed text-center">
          This is not financial advice. Trading involves risk of loss. Only trade with funds you can afford to lose.
        </p>

        {/* Copyright */}
        <div className="text-neutral-600 text-xs">
          <p>&copy; 2026 Mentioned. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
