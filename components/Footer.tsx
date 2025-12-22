export default function Footer() {
  return (
    <footer className="border-t border-white py-4 text-center mt-10">
      <div className="flex flex-col md:flex-row justify-center items-center gap-2 md:gap-6 font-mono text-xs uppercase">
        <a className="hover:bg-white hover:text-black" href="#">
          [MANIFESTO]
        </a>
        <a className="hover:bg-white hover:text-black" href="#">
          [DISCORD]
        </a>
        <a className="hover:bg-white hover:text-black" href="#">
          [X]
        </a>
        <p className="text-white/50 mt-4 md:mt-0">
          LEGAL DISCLAIMER: THIS IS NOT FINANCIAL ADVICE. PROBABLY. INVEST AT
          YOUR OWN PERIL. WE ARE NOT RESPONSIBLE FOR YOUR TERRIBLE DECISIONS.
        </p>
      </div>
    </footer>
  )
}

