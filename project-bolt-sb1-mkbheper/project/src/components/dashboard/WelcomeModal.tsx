import { X, Gift, ArrowRight, Zap, Users, Star } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  onClose: () => void;
  onClaimOffer: () => void;
  fullName?: string;
}

export default function WelcomeModal({ onClose, onClaimOffer, fullName }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  function close() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  function claimOffer() {
    setVisible(false);
    setTimeout(onClaimOffer, 300);
  }

  return (
    <div
      className={`fixed inset-0 z-[9000] flex items-center justify-center px-4 transition-all duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={close}
      />

      {/* Modal */}
      <div
        className={`relative z-10 w-full max-w-md bg-[#111] border border-white/8 rounded-3xl overflow-hidden shadow-2xl shadow-black/60 transition-all duration-300 ${
          visible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
      >
        {/* Top gradient bar */}
        <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400" />

        {/* Header */}
        <div className="relative bg-gradient-to-b from-amber-400/8 to-transparent px-7 pt-8 pb-6">
          <button
            onClick={close}
            className="absolute top-5 right-5 w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-all"
          >
            <X size={16} />
          </button>

          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-xl shadow-amber-500/25">
              <Gift size={26} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Star size={13} className="text-amber-400 fill-amber-400" />
                <span className="text-amber-400 text-xs font-bold tracking-wider uppercase">Exclusive Offer</span>
              </div>
              <h2 className="text-white font-black text-xl leading-tight">
                {fullName ? `Welcome, ${fullName.split(' ')[0]}!` : 'Welcome to MrHustler!'}
              </h2>
            </div>
          </div>

          <p className="text-gray-300 text-sm leading-relaxed">
            You have just unlocked your <span className="text-amber-400 font-semibold">new member bonus</span>.
            Complete your first task today and claim a special reward boost on top of your regular earnings.
          </p>
        </div>

        {/* Offer details */}
        <div className="px-7 pb-6 space-y-3">
          {[
            {
              icon: Zap,
              color: 'bg-amber-400/10 text-amber-400',
              title: 'First-Task Reward Boost',
              desc: 'Complete any task today and earn a special welcome bonus on top of the standard reward.',
            },
            {
              icon: Users,
              color: 'bg-green-500/10 text-green-400',
              title: 'Double Referral Bonus',
              desc: 'Your first 3 referrals this week earn you double the usual referral reward.',
            },
            {
              icon: Star,
              color: 'bg-blue-500/10 text-blue-400',
              title: 'Bronze Tier Instant Unlock',
              desc: 'Your Bronze membership is active. Start earning and unlock Silver tier faster.',
            },
          ].map(item => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="flex gap-4 bg-white/3 border border-white/5 rounded-2xl p-4"
              >
                <div className={`w-9 h-9 rounded-xl ${item.color} flex items-center justify-center flex-shrink-0`}>
                  <Icon size={16} />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{item.title}</p>
                  <p className="text-gray-400 text-xs leading-relaxed mt-0.5">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="px-7 pb-7 flex flex-col gap-3">
          <button
            onClick={claimOffer}
            className="group w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm hover:shadow-xl hover:shadow-amber-500/25 hover:-translate-y-0.5 transition-all"
          >
            Claim Offer — Start Earning
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </button>
          <button
            onClick={close}
            className="text-gray-500 hover:text-gray-300 text-xs transition-colors text-center"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
