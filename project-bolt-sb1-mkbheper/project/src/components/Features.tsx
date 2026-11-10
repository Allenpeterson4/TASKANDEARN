import {
  Zap,
  Shield,
  Smartphone,
  Clock,
  TrendingUp,
  Award,
  CreditCard,
  Headphones,
} from 'lucide-react';

const features = [
  {
    icon: Zap,
    title: 'Instant Hustle Matching',
    description:
      'Our smart algorithm serves you hustles matched to your profile and earning potential in real time.',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
  },
  {
    icon: Shield,
    title: 'Bank-Grade Security',
    description:
      'Your personal and financial data is encrypted end-to-end. We take your safety as seriously as your earnings.',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
  },
  {
    icon: Smartphone,
    title: 'Mobile-First Experience',
    description:
      'Earn on the go from any device. Our platform is fully optimized for both Android and iOS users.',
    color: 'text-green-400',
    bg: 'bg-green-400/10',
  },
  {
    icon: Clock,
    title: 'Flexible Earning Hours',
    description:
      'There are no schedules here. Work your own hours, at your own pace — morning, afternoon, or midnight.',
    color: 'text-purple-400',
    bg: 'bg-purple-400/10',
  },
  {
    icon: TrendingUp,
    title: 'Scaling Rewards',
    description:
      'The more you engage and refer, the higher your earning tier. Loyal hustlers unlock premium, high-value hustles.',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
  },
  {
    icon: Award,
    title: 'Achievement Bonuses',
    description:
      'Hit milestones and unlock bonus multipliers. Consistent performers get extra payouts, leaderboard spots, and prizes.',
    color: 'text-rose-400',
    bg: 'bg-rose-400/10',
  },
  {
    icon: CreditCard,
    title: 'All Nigerian Banks Supported',
    description:
      'Withdraw directly to GTB, Access, Opay, Palmpay, Kuda, and every major Nigerian bank or fintech wallet.',
    color: 'text-teal-400',
    bg: 'bg-teal-400/10',
  },
  {
    icon: Headphones,
    title: '24/7 Support',
    description:
      'Our dedicated Nigerian support team is always available via live chat, email, and WhatsApp to help you.',
    color: 'text-indigo-400',
    bg: 'bg-indigo-400/10',
  },
];

export default function Features() {
  return (
    <section id="features" className="relative py-28 bg-[#0a0a0a] overflow-hidden">
      {/* bg glow */}
      <div className="absolute -top-32 right-0 w-[500px] h-[500px] bg-amber-500/4 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-32 left-0 w-[500px] h-[500px] bg-blue-500/4 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <span className="inline-block text-amber-400 text-xs font-bold tracking-[0.3em] uppercase mb-4">
            Platform Features
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5">
            Everything You Need to
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              Earn Without Limits
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
            MrHustler is engineered for one purpose — to make earning real Naira
            online as effortless and rewarding as possible.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map(feat => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="group bg-[#111] border border-white/5 rounded-2xl p-6 hover:border-white/10 hover:bg-[#141414] hover:-translate-y-1 transition-all duration-300"
              >
                <div className={`w-12 h-12 rounded-xl ${feat.bg} flex items-center justify-center mb-4`}>
                  <Icon size={22} className={feat.color} />
                </div>
                <h3 className="text-white font-bold text-base mb-2">{feat.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{feat.description}</p>
              </div>
            );
          })}
        </div>

        {/* Highlight banner */}
        <div className="mt-16 relative rounded-3xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-400/10 via-orange-500/5 to-amber-400/10 border border-amber-400/15 rounded-3xl" />
          <div className="relative p-10 lg:p-14 grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <h3 className="text-3xl font-black text-white mb-3">
                Built Specifically
                <br />
                <span className="text-amber-400">for Nigerians</span>
              </h3>
              <p className="text-gray-400 leading-relaxed">
                Every feature, every payout method, every hustle category — designed
                with the Nigerian hustler in mind. We understand your realities
                and have built a platform that works for you, not against you.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Hustles Available', value: '500+' },
                { label: 'Daily Earners', value: '15K+' },
                { label: 'Avg. Payout Time', value: '< 2 hrs' },
                { label: 'Hustle Categories', value: '20+' },
              ].map(item => (
                <div
                  key={item.label}
                  className="bg-white/4 rounded-2xl p-4 text-center border border-white/6"
                >
                  <p className="text-2xl font-black text-amber-400">{item.value}</p>
                  <p className="text-gray-400 text-xs mt-1">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
