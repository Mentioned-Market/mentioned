export default function Footer() {
  return (
    <footer className="border-t border-white/10 py-8 text-center">
      {/* Hidden SEO-rich content for search engines */}
      <div className="sr-only">
        <h2>About Mentioned - The Premier Mention Markets Platform</h2>
        <p>Mentioned is the leading mention markets platform where you can trade predictions on what gets mentioned in real-world events. Join Mentioned to access mention markets for speeches, podcasts, earnings calls, and more.</p>
        <p>Why choose Mentioned? Mentioned offers the most comprehensive mention markets with transparent, decentralized trading on Solana. Trade mention predictions on Mentioned.markets today.</p>
        <nav aria-label="Footer Navigation">
          <ul>
            <li><a href="/">Mentioned Home - Mention Markets</a></li>
            <li><a href="/waitlist">Join Mentioned Waitlist</a></li>
            <li><a href="/profile">Mentioned Profile</a></li>
          </ul>
        </nav>
        <address>
          <p>Connect with Mentioned:</p>
          <p>Twitter: @mentionedmarket</p>
          <p>Discord: discord.gg/gsD7vf6YRx</p>
          <p>Website: mentioned.markets</p>
        </address>
        <p>Keywords: mentioned, mention markets, mentioned markets, prediction markets, mention trading, mentioned platform, speech predictions, podcast predictions, event predictions, decentralized prediction markets, solana prediction markets, bet on mentions, trade mentions</p>
      </div>

      <div className="flex flex-col items-center gap-6">
        {/* Social Links */}
        <div className="flex items-center gap-6">
          <a 
            className="text-neutral-400 hover:text-white text-sm font-medium transition-colors duration-200" 
            href="https://discord.gg/gsD7vf6YRx" 
            target="_blank" 
            rel="noopener noreferrer"
            aria-label="Join Mentioned on Discord"
          >
            Discord
          </a>
          <span className="text-neutral-600">•</span>
          <a 
            className="text-neutral-400 hover:text-white text-sm font-medium transition-colors duration-200" 
            href="https://x.com/mentionedmarket" 
            target="_blank" 
            rel="noopener noreferrer"
            aria-label="Follow Mentioned on Twitter/X"
          >
            Twitter
          </a>
        </div>
        
        {/* Legal Disclaimer */}
        <p className="text-neutral-500 text-xs max-w-2xl leading-relaxed">
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

