import { BadgeCheck, Building2, CircleDollarSign, ClipboardCheck, SearchCheck } from 'lucide-react';

const reasons = [
  {
    icon: Building2,
    title: 'Brand-funded campaigns',
    description:
      'Brands and platform partners fund campaigns when they need authentic reach, feedback, or qualified engagement. Campaign budgets determine the reward.',
    iconColor: 'text-blue-400',
    iconBackground: 'bg-blue-500/10',
  },
  {
    icon: SearchCheck,
    title: 'Research and feedback',
    description:
      'Survey and review campaigns compensate eligible participants for useful responses that help teams understand customer needs and improve products.',
    iconColor: 'text-amber-400',
    iconBackground: 'bg-amber-500/10',
  },
  {
    icon: CircleDollarSign,
    title: 'Verified rewards',
    description:
      'Complete the specific action described in a campaign. Once the submission is verified against its terms, the stated reward is credited to your wallet.',
    iconColor: 'text-green-400',
    iconBackground: 'bg-green-500/10',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative py-28 bg-[#0d0d0d] overflow-hidden"
    >
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <span className="inline-block text-amber-400 text-xs font-bold tracking-[0.3em] uppercase mb-4">
            Clear campaigns. Verified rewards.
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5">
            How earning works
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              and why hustles pay
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
            Rewards come from funded partner campaigns, research, and marketing activity. Each listing shows its requirements and reward before you start.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {reasons.map(({ icon: Icon, title, description, iconColor, iconBackground }) => (
            <article key={title} className="border border-white/8 bg-[#111] p-7 sm:p-8">
              <div className={`mb-6 flex h-12 w-12 items-center justify-center ${iconBackground} ${iconColor}`}>
                <Icon size={22} />
              </div>
              <h3 className="mb-3 text-xl font-bold text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-400">{description}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 grid gap-4 border border-white/8 bg-white/3 p-6 sm:grid-cols-2 sm:p-8">
          <div className="flex items-start gap-3">
            <ClipboardCheck size={19} className="mt-0.5 shrink-0 text-amber-400" />
            <div><h3 className="text-sm font-bold text-white">Clear hustle terms</h3><p className="mt-1 text-xs leading-relaxed text-gray-400">Review eligibility, links, proof requirements, and rewards before starting a hustle.</p></div>
          </div>
          <div className="flex items-start gap-3">
            <BadgeCheck size={19} className="mt-0.5 shrink-0 text-green-400" />
            <div><h3 className="text-sm font-bold text-white">Review before credit</h3><p className="mt-1 text-xs leading-relaxed text-gray-400">Rewards are credited after the campaign's stated verification requirements are met.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}
