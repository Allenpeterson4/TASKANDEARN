import { Star, Quote } from 'lucide-react';

const testimonials = [
  {
    name: 'Amaka Chukwu',
    location: 'Lagos, Nigeria',
    role: 'Student',
    content:
      'I was skeptical at first, but MrHustler actually pays! I completed a few hustles between lectures and had money in my account before dinner. This platform is the real deal.',
    rating: 5,
    avatar: 'AC',
    color: 'from-amber-400 to-orange-500',
  },
  {
    name: 'Babatunde Lawal',
    location: 'Ibadan, Nigeria',
    role: 'Freelancer',
    content:
      'The referral program alone has been life-changing. I shared my link on WhatsApp and now I have a passive stream coming in daily. MrHustler is the side income I never knew I needed.',
    rating: 5,
    avatar: 'BL',
    color: 'from-blue-400 to-blue-600',
  },
  {
    name: 'Chioma Okafor',
    location: 'Enugu, Nigeria',
    role: 'Entrepreneur',
    content:
      'The withdrawals are super fast — I got paid within an hour. No stress, no excuses. I have tried other platforms but none come close to the experience on MrHustler.',
    rating: 5,
    avatar: 'CO',
    color: 'from-green-400 to-emerald-600',
  },
  {
    name: 'Yusuf Aliyu',
    location: 'Kano, Nigeria',
    role: 'Graduate',
    content:
      'As a fresh graduate looking for income while job hunting, MrHustler has been a lifesaver. The hustles are straightforward and the support team actually responds quickly.',
    rating: 5,
    avatar: 'YA',
    color: 'from-purple-400 to-purple-600',
  },
  {
    name: 'Funmilayo Adeyemi',
    location: 'Abuja, Nigeria',
    role: 'Stay-at-Home Mum',
    content:
      'I do tasks during my free time while the kids are at school. By the end of the week I have made a meaningful amount that genuinely helps my household. God bless whoever built this.',
    rating: 5,
    avatar: 'FA',
    color: 'from-rose-400 to-pink-600',
  },
  {
    name: 'Emeka Nwachukwu',
    location: 'Port Harcourt, Nigeria',
    role: 'Driver',
    content:
      'Between trips I open MrHustler and knock out a couple of tasks. Easy money on the side. Platform is smooth, no wahala, payment drops straight to my OPay.',
    rating: 5,
    avatar: 'EN',
    color: 'from-teal-400 to-cyan-600',
  },
];

export default function Testimonials() {
  return (
    <section className="relative py-28 bg-[#0d0d0d] overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/3 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block text-amber-400 text-xs font-bold tracking-[0.3em] uppercase mb-4">
            Real Earners
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5">
            What Our Community
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              Is Saying
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
            Don't take our word for it. Here is what real Nigerian earners have
            to say about their experience with MrHustler.
          </p>
        </div>

        {/* Testimonial grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map(t => (
            <div
              key={t.name}
              className="bg-[#111] border border-white/5 rounded-2xl p-6 hover:border-white/10 hover:-translate-y-1 transition-all duration-300 flex flex-col"
            >
              {/* Quote icon */}
              <Quote size={28} className="text-amber-400/20 mb-4" />

              {/* Stars */}
              <div className="flex gap-1 mb-4">
                {Array(t.rating).fill(0).map((_, i) => (
                  <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                ))}
              </div>

              {/* Content */}
              <p className="text-gray-300 text-sm leading-relaxed flex-1 mb-6">"{t.content}"</p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${t.color} flex items-center justify-center flex-shrink-0`}
                >
                  <span className="text-white text-xs font-black">{t.avatar}</span>
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{t.name}</p>
                  <p className="text-gray-500 text-xs">
                    {t.role} · {t.location}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust strip */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-8">
          {[
            'Verified Payouts',
            'No Hidden Charges',
            'Nigerian Support Team',
            'Secure Platform',
            '4.9★ Rating',
          ].map(badge => (
            <div key={badge} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-gray-400 text-sm">{badge}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
