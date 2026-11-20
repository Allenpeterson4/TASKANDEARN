import { Users, Copy, TrendingUp, Gift, ArrowRight, CheckCircle } from 'lucide-react';
import { useSiteContent } from '@/hooks/useSiteContent';
import {
  formatReferralRange,
  legacyReferralStepKeys,
  parseReferralConfig,
  referralConfigKey,
  referralTierColors,
} from '@/lib/referralConfig';

export default function Referral() {
  const referralCopy = useSiteContent([referralConfigKey, ...legacyReferralStepKeys]);
  const config = parseReferralConfig(referralCopy[referralConfigKey], legacyReferralStepKeys.map(key => referralCopy[key]));

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
            <h3 className="text-2xl font-black text-white mb-8">{config.stepsTitle}</h3>
            <div className="space-y-5">
              {config.steps.map((step, i) => (
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
            {config.tiersTitle}
          </h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {config.tiers.map(tier => {
              const style = referralTierColors[tier.color];
              return <div
                key={tier.id}
                className={`relative rounded-2xl border bg-[#111] p-6 transition-all duration-300 hover:-translate-y-1 ${style.border} ${
                  tier.popular ? 'ring-1 ring-amber-400/40' : ''
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-amber-400 text-black text-xs font-black whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                <div
                  className={`mb-4 inline-block rounded-lg bg-gradient-to-r px-3 py-1.5 text-xs font-black text-black ${style.gradient}`}
                >
                  {tier.name}
                </div>
                <p className="mb-1 text-sm font-bold text-white">{formatReferralRange(tier)}</p>
                {tier.rewardLabel && <p className="mb-1 text-base font-black text-amber-400">{tier.rewardLabel}</p>}
                {tier.benefits && <p className="text-xs leading-relaxed text-gray-400">{tier.benefits}</p>}
              </div>;
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
