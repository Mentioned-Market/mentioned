export default function Ticker() {
  const tickerText =
    ">> LATEST >> TRUMP ANNOUNCES PLAN TO BUILD MOAT AROUND FLORIDA FILLED WITH ROBOTIC ALLIGATORS >> ELON MUSK CHALLENGES MARK ZUCKERBERG TO A JELLO-WRESTLING MATCH ON MARS >> SCIENTISTS DISCOVER SQUIRRELS ARE SECRETLY RUNNING THE STOCK MARKET >> WORLD'S CATS DECLARE GLOBAL NAP DAY >>"

  return (
    <div className="ticker-wrap mt-4">
      <div className="ticker-move font-mono text-xl">
        <p className="inline-block px-4">
          <span className="glitch-text" data-text={tickerText}>
            {tickerText}
          </span>
        </p>
        <p className="inline-block px-4">
          <span className="glitch-text" data-text={tickerText}>
            {tickerText}
          </span>
        </p>
      </div>
    </div>
  )
}

