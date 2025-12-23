'use client'

interface ResolveRule {
  outcome: 'YES' | 'NO'
  description: string
}

interface ResolveRulesProps {
  title: string
  rules: ResolveRule[]
}

export default function ResolveRules({ title, rules }: ResolveRulesProps) {
  return (
    <div className="bg-[#1a1a1a] rounded-lg">
      <div className="p-4">
        <h3 className="text-white font-bold text-xl uppercase">RESOLVE RULES</h3>
      </div>
      
      <div className="p-6 space-y-4">
        <p className="text-white text-sm mb-4">
          Market: <span className="font-bold">{title}</span>
        </p>

        <div className="space-y-4">
          {rules.map((rule, index) => (
            <div
              key={index}
              className={`p-4 rounded ${
                rule.outcome === 'YES'
                  ? 'bg-green-500/10'
                  : 'bg-red-500/10'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`font-bold text-lg ${
                    rule.outcome === 'YES' ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  [{rule.outcome}]
                </div>
                <div className="text-white text-sm flex-1">
                  {rule.description}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/20 pt-4 mt-6">
          <p className="text-white/70 text-xs">
            RESOLUTION: Market will resolve based on official transcripts and video verification
            within 24 hours after the event concludes. Disputes can be raised within 48 hours
            of initial resolution.
          </p>
        </div>
      </div>
    </div>
  )
}

