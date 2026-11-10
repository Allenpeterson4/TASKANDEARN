import { Users, Copy, TrendingUp, Gift, ArrowRight, CheckCircle } from 'lucide-react';

const tiers = [
  {
    level: 'Bronze',
    refs: '1–4 referrals',
    perRef: 'Standard Bonus',
    extras: 'Access to basic referral dashboard',
    color: 'from-amber-700 to-amber-600',
    glow: 'shadow-amber-700/20',
    border: 'border-amber-700/30',
  },
  {
    level: 'Silver',
    refs: '5–19 referrals',
    perRef: 'Enhanced Bonus',
    extras: '+ Leaderboard visibility',
    color: 'from-gray-400 to-gray-300',
    glow: 'shadow-gray-400/20',
    border: 'border-gray-400/30',
    popular: false,
  },
  {
    level: 'Gold',
    refs: '20–49 referrals',
    perRef: 'Premium Bonus',
    extras: '+ Priority hustle access',
    color: 'from-amber-400 to-yellow-300',
    glow: 'shadow-amber-400/30',
    border: 'border-amber-400/40',
    popular: true,
  },
  {
    level: 'Platinum',
    refs: '50+ referrals',
    perRef: 'Maximum Bonus',
    extras: '+ Exclusive VIP rewards',
    color: 'from-blue-400 to-cyan-300',
    glow: 'shadow-blue-400/20',
    border: 'border-blue-400/30',
  },
];

const steps = [
  'Share your unique referral link via WhatsApp, Instagram, or any channel',
  'Your friend signs up and completes their first verified task',
  'Both you and your friend receive an instant bonus reward',
  'Earn passive income every time your referral completes tasks',
];

export default function Referral() {
  return (
    <section id="referral" className="relative py-28 bg-[#0d0d0d] overflow-hidden">
      <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-amber-500/4 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <span className="inline-block text-amber-400 text-xs font-bold tracking-[0.3em] uppercase mb-4">
            Referral Program
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5">
            Refer Friends &
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              Multiply Your Earnings
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
            Your network is your net worth. Every friend you bring to MrHustler
            earns you a bonus — and keeps paying as they earn.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-16 items-center mb-20">
          {/* How referral works */}
          <div>
            <h3 className="text-2xl font-black text-white mb-8">How Referrals Work</h3>
            <div className="space-y-5">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
                    <span className="text-amber-400 text-xs font-black">{i + 1}</span>
                  </div>
                  <p className="text-gray-300 leading-relaxed text-sm pt-1">{step}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 bg-[#111] border border-white/6 rounded-2xl p-6">
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-3 font-semibold">Your Referral Link</p>
              <div className="flex items-center gap-3 bg-[#0a0a0a] rounded-xl p-3 border border-white/5">
                <span className="text-gray-300 text-sm flex-1 truncate font-mono">
                  mrhustler.ng/ref/YOURCODE
                </span>
                <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-400/10 hover:bg-amber-400/20 text-amber-400 text-xs font-semibold transition-colors">
                  <Copy size={12} />
                  Copy
                </button>
              </div>
              <div className="flex gap-3 mt-4">
                {['WhatsApp', 'Twitter/X', 'Facebook', 'Telegram'].map(channel => (
                  <button
                    key={channel}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold text-gray-400 hover:text-white border border-white/8 hover:border-white/15 hover:bg-white/5 transition-all truncate"
                  >
                    {channel}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bonus visual */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center">
                <Gift size={18} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-white font-bold">Referral Bonus Benefits</h3>
                <p className="text-gray-400 text-sm">The more you refer, the more you earn</p>
              </div>
            </div>

            <div className="space-y-4">
              {[
                { icon: Users, text: 'Earn a bonus for every friend who signs up through your link' },
                { icon: TrendingUp, text: 'Earn rewards as every referral completes hustles' },
                { icon: Gift, text: 'Unlock higher referral bonus tiers as your network grows' },
                { icon: CheckCircle, text: 'No cap on how many friends you can refer' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex gap-4 items-start bg-[#111] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center flex-shrink-0">
                    <Icon size={15} className="text-amber-400" />
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed">{text}</p>
                </div>
              ))}
            </div>

            <button className="group mt-8 flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm hover:shadow-2xl hover:shadow-amber-500/30 hover:-translate-y-1 transition-all duration-300 w-full justify-center">
              Get Your Referral Link
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>

        {/* Tier table */}
        <div>
          <h3 className="text-2xl font-black text-white text-center mb-10">
            Referral Reward Tiers
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {tiers.map(tier => (
              <div
                key={tier.level}
                className={`relative bg-[#111] border ${tier.border} rounded-2xl p-6 hover:-translate-y-1 transition-all duration-300 ${
                  tier.popular ? 'ring-1 ring-amber-400/40' : ''
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-amber-400 text-black text-xs font-black whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                <div
                  className={`inline-block px-3 py-1.5 rounded-lg bg-gradient-to-r ${tier.color} text-black text-xs font-black mb-4`}
                >
                  {tier.level}
                </div>
                <p className="text-white font-bold text-sm mb-1">{tier.refs}</p>
                <p className="text-amber-400 font-black text-base mb-1">{tier.perRef}</p>
                <p className="text-gray-400 text-xs leading-relaxed">{tier.extras}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
