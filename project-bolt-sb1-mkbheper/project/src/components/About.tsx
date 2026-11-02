import { Target, Eye, Heart, Users } from 'lucide-react';

const team = [
  {
    name: 'Chukwuemeka Obi',
    role: 'Founder & CEO',
    img: 'https://images.pexels.com/photos/36766770/pexels-photo-36766770.jpeg?auto=compress&cs=tinysrgb&h=200&w=200',
  },
  {
    name: 'Adaeze Nwosu',
    role: 'Head of Operations',
    img: 'https://images.pexels.com/photos/8837261/pexels-photo-8837261.jpeg?auto=compress&cs=tinysrgb&h=200&w=200',
  },
  {
    name: 'Tunde Fashola',
    role: 'Chief Technology Officer',
    img: 'https://images.pexels.com/photos/7691691/pexels-photo-7691691.jpeg?auto=compress&cs=tinysrgb&h=200&w=200',
  },
  {
    name: 'Ngozi Eze',
    role: 'Head of Community',
    img: 'https://images.pexels.com/photos/39462471/pexels-photo-39462471.jpeg?auto=compress&cs=tinysrgb&h=200&w=200',
  },
];

const values = [
  {
    icon: Target,
    title: 'Mission',
    description:
      'To create the most accessible and rewarding earning platform for every Nigerian — from Lagos to Kano, Abuja to Port Harcourt.',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
  },
  {
    icon: Eye,
    title: 'Vision',
    description:
      'A Nigeria where anyone with a smartphone can build meaningful supplemental income from the comfort of their home.',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
  },
  {
    icon: Heart,
    title: 'Values',
    description:
      'Transparency in every payout. Integrity in every task. Genuine care for the financial well-being of every member of our community.',
    color: 'text-rose-400',
    bg: 'bg-rose-400/10',
  },
];

export default function About() {
  return (
    <section id="about" className="relative py-28 bg-[#0d0d0d] overflow-hidden">
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-amber-500/3 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <span className="inline-block text-amber-400 text-xs font-bold tracking-[0.3em] uppercase mb-4">
            Our Story
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5">
            Built by Nigerians,
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              For Nigerians
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto leading-relaxed">
            MrHustler was born from a simple belief: every hardworking Nigerian
            deserves a fair and transparent way to earn online — without scams,
            gatekeeping, or confusion.
          </p>
        </div>

        {/* Story + Image */}
        <div className="grid lg:grid-cols-2 gap-16 items-center mb-24">
          <div>
            <div className="space-y-5 text-gray-400 leading-relaxed">
              <p>
                We started MrHustler after watching too many talented, hardworking
                Nigerians get burned by fake platforms that promised big earnings
                and delivered nothing. We knew the problem was not lack of skill or
                effort — it was the absence of a platform they could truly trust.
              </p>
              <p>
                Our founding team combined decades of experience in fintech,
                digital marketing, and community building to create something
                different. A platform that pays on time, every time. A community
                where every member grows together. A brand that Nigerians can be
                proud of.
              </p>
              <p>
                Today, MrHustler is home to tens of thousands of active earners
                across all 36 states of Nigeria. We are growing fast, paying big,
                and just getting started.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-6">
              {[
                { label: 'Founded', value: '2023' },
                { label: 'States Covered', value: '36' },
                { label: 'Team Size', value: '40+' },
                { label: 'Support Hours', value: '24/7' },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-2xl font-black text-white">{item.value}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="rounded-3xl overflow-hidden shadow-2xl shadow-black/50">
              <img
                src="https://images.pexels.com/photos/7640741/pexels-photo-7640741.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
                alt="MrHustler team collaboration"
                className="w-full h-[420px] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d0d]/40 to-transparent" />
            </div>
            {/* Badge */}
            <div className="absolute -bottom-6 -left-6 bg-[#161616] border border-white/8 rounded-2xl p-5 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center">
                  <Users size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-bold">50,000+</p>
                  <p className="text-gray-400 text-xs">Active Community</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Values */}
        <div className="grid md:grid-cols-3 gap-6 mb-24">
          {values.map(val => {
            const Icon = val.icon;
            return (
              <div
                key={val.title}
                className="bg-[#111] border border-white/5 rounded-2xl p-7 hover:border-white/10 hover:-translate-y-1 transition-all duration-300"
              >
                <div className={`w-12 h-12 rounded-xl ${val.bg} flex items-center justify-center mb-5`}>
                  <Icon size={22} className={val.color} />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">{val.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{val.description}</p>
              </div>
            );
          })}
        </div>

        {/* Team */}
        <div>
          <h3 className="text-2xl font-black text-white text-center mb-12">
            Meet the Team Behind the Hustle
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {team.map(member => (
              <div
                key={member.name}
                className="group bg-[#111] border border-white/5 rounded-2xl p-5 text-center hover:border-white/10 hover:-translate-y-1 transition-all duration-300"
              >
                <div className="w-20 h-20 rounded-2xl overflow-hidden mx-auto mb-4 ring-2 ring-white/5 group-hover:ring-amber-400/20 transition-all">
                  <img
                    src={member.img}
                    alt={member.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-white font-bold text-sm">{member.name}</p>
                <p className="text-gray-400 text-xs mt-1">{member.role}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
