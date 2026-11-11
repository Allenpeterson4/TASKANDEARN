import { ArrowRight, ChevronDown, Star, Users, Zap, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSiteContent } from '@/hooks/useSiteContent';
import { supabase } from '@/lib/supabase';

const stats = [
  { value: '50K+', label: 'Active Earners' },
  { value: '₦2B+', label: 'Rewards Paid' },
  { value: '99.8%', label: 'Uptime' },
  { value: '4.9★', label: 'User Rating' },
];

export default function Hero() {
  const content = useSiteContent(['home.hero.title', 'home.hero.description', 'home.hero.image']);
  const titleLines = (content['home.hero.title'] || 'Turn Every\nHustle into\nReal Naira').split('\n');
  const heroImagePath = content['home.hero.image'];
  const heroImageUrl = heroImagePath && !/^https?:\/\//i.test(heroImagePath)
    ? supabase.storage.from('site-media').getPublicUrl(heroImagePath).data.publicUrl
    : null;

  return (
    <section
      id="home"
      className="relative min-h-screen flex items-center overflow-hidden bg-[#0a0a0a]"
    >
      {/* Background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-orange-600/5 rounded-full blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left content */}
          <div>
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-amber-400/20 bg-amber-400/5 mb-6">
              <Star size={14} className="text-amber-400 fill-amber-400" />
              <span className="text-amber-400 text-xs font-semibold tracking-wide uppercase">
                Nigeria's #1 Earning Platform
              </span>
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-[4.5rem] font-black text-white leading-[1.05] mb-6">
              {titleLines.map((line, index) => (
                <span
                  key={`${line}-${index}`}
                  className={`block ${index === 1 ? 'text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-orange-600' : ''}`}
                >
                  {line}
                </span>
              ))}
            </h1>

            <p className="text-gray-400 text-lg leading-relaxed mb-8 max-w-xl">
              {content['home.hero.description'] || 'Join thousands of Nigerians earning significant rewards daily by completing simple tasks, surveys, and referring friends. Your hustle, your earnings, paid directly to your bank account.'}
            </p>

            {/* Trust signals */}
            <div className="flex flex-wrap items-center gap-4 mb-10">
              {[
                { icon: Shield, text: 'Verified Payouts' },
                { icon: Zap, text: 'Instant Withdrawal' },
                { icon: Users, text: 'No Hidden Fees' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Icon size={10} className="text-green-400" />
                  </div>
                  <span className="text-gray-400 text-sm">{text}</span>
                </div>
              ))}
            </div>

            {/* CTA buttons */}
            <div className="flex flex-wrap gap-4">
              <Link
                to="/how-it-works"
                className="group flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-base hover:shadow-2xl hover:shadow-amber-500/30 hover:-translate-y-1 transition-all duration-300"
              >
                Start Earning Now
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                to="/how-it-works"
                className="flex items-center gap-2 px-8 py-4 rounded-2xl border border-white/10 text-white font-semibold text-base hover:bg-white/5 hover:border-white/20 transition-all duration-300"
              >
                How It Works
              </Link>
            </div>
          </div>

          {/* Right: image + floating cards */}
          <div className="relative lg:pl-8">
            <div className="relative min-h-[480px] overflow-hidden rounded-3xl bg-[#161616] shadow-2xl shadow-black/50">
              {heroImageUrl && <>
                <img src={heroImageUrl} alt="Earning potential with MrHustler" loading="eager" fetchPriority="high" className="h-[480px] w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a]/60 via-transparent to-transparent" />
              </>}
            </div>

            {/* Floating cards */}
            <div className="absolute -left-6 top-12 bg-[#161616] border border-white/8 rounded-2xl p-4 shadow-2xl shadow-black/40 backdrop-blur-md animate-float">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <span className="text-green-400 text-lg font-black">₦</span>
                </div>
                <div>
                  <p className="text-white font-bold text-base">Payment Sent!</p>
                  <p className="text-gray-400 text-xs">Withdrawal successful</p>
                </div>
              </div>
            </div>

            <div className="absolute -right-4 bottom-20 bg-[#161616] border border-white/8 rounded-2xl p-4 shadow-2xl shadow-black/40 backdrop-blur-md animate-float-delay">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <Users size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">+1,204 joined today</p>
                  <p className="text-gray-400 text-xs">Growing community</p>
                </div>
              </div>
            </div>

            <div className="absolute right-8 top-8 bg-[#161616] border border-white/8 rounded-2xl p-3 shadow-2xl shadow-black/40 backdrop-blur-md">
              <div className="flex gap-1 mb-1">
                {Array(5).fill(0).map((_, i) => (
                  <Star key={i} size={12} className="text-amber-400 fill-amber-400" />
                ))}
              </div>
              <p className="text-white text-xs font-semibold">Rated 4.9/5</p>
              <p className="text-gray-400 text-xs">by 12,000+ users</p>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-20 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(stat => (
            <div
              key={stat.value}
              className="bg-white/3 border border-white/6 rounded-2xl p-5 text-center hover:bg-white/5 hover:border-white/10 transition-all duration-300"
            >
              <p className="text-3xl font-black text-white mb-1">{stat.value}</p>
              <p className="text-gray-400 text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <Link
        to="/how-it-works"
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors animate-bounce"
      >
        <span className="text-xs tracking-widest uppercase">Scroll</span>
        <ChevronDown size={18} />
      </Link>
    </section>
  );
}
