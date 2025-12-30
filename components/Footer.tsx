export default function Footer() {
  return (
    <footer className="border-t border-white py-4 text-center mt-10">
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

      <div className="flex flex-col md:flex-row justify-center items-center gap-2 md:gap-6 font-mono text-xs uppercase">
        <a 
          className="hover:bg-white hover:text-black transition-colors" 
          href="https://discord.gg/gsD7vf6YRx" 
          target="_blank" 
          rel="noopener noreferrer"
          aria-label="Join Mentioned on Discord"
        >
          [DISCORD]
        </a>
        <a 
          className="hover:bg-white hover:text-black transition-colors" 
          href="https://x.com/mentionedmarket" 
          target="_blank" 
          rel="noopener noreferrer"
          aria-label="Follow Mentioned on Twitter/X"
        >
          [X / TWITTER]
        </a>
        <p className="text-white/50 mt-4 md:mt-0">
          MENTIONED - MENTION MARKETS PLATFORM | LEGAL DISCLAIMER: THIS IS NOT FINANCIAL ADVICE. INVEST AT YOUR OWN RISK.
        </p>
      </div>
      
      <div className="mt-4 text-white/30 text-xs">
        <p>© 2024 Mentioned. Mention Markets Platform. All rights reserved.</p>
      </div>
    </footer>
  )
}

