'use client'

interface Word {
  word: string
  yesPrice: string
  noPrice: string
  volume: number
}

interface WordListProps {
  words: Word[]
  selectedWord: string
  onSelectWord: (word: string) => void
}

export default function WordList({ words, selectedWord, onSelectWord }: WordListProps) {
  return (
    <div className="bg-black">
      <div className="border-b border-white/30 p-2">
        <h3 className="text-white font-bold text-sm uppercase">SELECT WORD</h3>
      </div>
      
      <div className="flex overflow-x-auto p-2 gap-2" style={{ scrollbarWidth: 'thin' }}>
        {words.map((word, index) => (
          <button
            key={index}
            onClick={() => onSelectWord(word.word)}
            className={`flex-shrink-0 p-3 border-2 transition-colors min-w-[140px] ${
              selectedWord === word.word
                ? 'bg-white text-black border-white'
                : 'bg-black text-white border-white/30 hover:bg-white/10 hover:border-white/50'
            }`}
          >
            <div className="text-left">
              <div className="text-sm font-bold uppercase mb-1">{word.word}</div>
              <div className="text-xs space-y-0.5">
                <div className={selectedWord === word.word ? 'text-black/70' : 'text-white/70'}>
                  YES: ${word.yesPrice}
                </div>
                <div className={selectedWord === word.word ? 'text-black/70' : 'text-white/70'}>
                  NO: ${word.noPrice}
                </div>
                <div className={`font-bold ${selectedWord === word.word ? 'text-black' : 'text-white'}`}>
                  ${(word.volume / 1000).toFixed(0)}K
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
