import { UserPlus, ClipboardList, DollarSign, ArrowRight } from 'lucide-react';

const steps = [
  {
    step: '01',
    icon: UserPlus,
    title: 'Create Your Account',
    description:
      'Sign up in under 60 seconds with just your email and phone number. No complicated forms — just your basic details and you are in.',
    color: 'from-blue-500 to-blue-600',
    glow: 'shadow-blue-500/20',
    bgSoft: 'bg-blue-500/10',
    iconColor: 'text-blue-400',
  },
  {
    step: '02',
    icon: ClipboardList,
    title: 'Pick & Complete Tasks',
    description:
      'Browse a curated library of tasks tailored for you — from surveys and social actions to app reviews and referrals. Each task is quick, clear, and rewarding.',
    color: 'from-amber-400 to-orange-500',
    glow: 'shadow-amber-500/20',
    bgSoft: 'bg-amber-500/10',
    iconColor: 'text-amber-400',
  },
  {
    step: '03',
    icon: DollarSign,
    title: 'Withdraw Your Earnings',
    description:
      'Cash out directly to any Nigerian bank account or mobile wallet. No minimum hold period — your rewards are yours the moment you earn them.',
    color: 'from-green-500 to-emerald-600',
    glow: 'shadow-green-500/20',
    bgSoft: 'bg-green-500/10',
    iconColor: 'text-green-400',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative py-28 bg-[#0d0d0d] overflow-hidden"
    >
      {/* Background accent */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-amber-500/3 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <span className="inline-block text-amber-400 text-xs font-bold tracking-[0.3em] uppercase mb-4">
            Simple Process
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5">
            Three Steps to
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              Financial Freedom
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
            No special skills required. If you have a smartphone and a few
            minutes to spare, you already have everything you need.
          </p>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Connector line */}
          <div className="hidden lg:block absolute top-24 left-[calc(16.67%+24px)] right-[calc(16.67%+24px)] h-[2px]">
            <div className="w-full h-full bg-gradient-to-r from-blue-500/30 via-amber-400/30 to-green-500/30 rounded-full" />
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.step} className="group relative">
                  <div className="bg-[#111] border border-white/6 rounded-3xl p-8 hover:border-white/12 hover:-translate-y-2 transition-all duration-400 h-full">
                    {/* Step number */}
                    <div className="flex items-center justify-between mb-6">
                      <div
                        className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-xl ${step.glow}`}
                      >
                        <Icon size={24} className="text-white" />
                      </div>
                      <span className="text-6xl font-black text-white/4 select-none">
                        {step.step}
                      </span>
                    </div>

                    <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
                    <p className="text-gray-400 leading-relaxed text-sm">{step.description}</p>

                    {/* Learn more */}
                    {index < steps.length - 1 && (
                      <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-gray-500 group-hover:text-amber-400 transition-colors">
                        Next step <ArrowRight size={14} />
                      </div>
                    )}
                    {index === steps.length - 1 && (
                      <div className="mt-6">
                        <button className="flex items-center gap-2 text-xs font-semibold text-green-400 hover:text-green-300 transition-colors">
                          Start now <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-16">
          <button className="group inline-flex items-center gap-3 px-10 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-base hover:shadow-2xl hover:shadow-amber-500/30 hover:-translate-y-1 transition-all duration-300">
            Join & Start Earning
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </button>
          <p className="text-gray-500 text-sm mt-4">Free to join. No credit card required.</p>
        </div>
      </div>
    </section>
  );
}
