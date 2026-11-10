import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSiteContent } from '@/hooks/useSiteContent';

const faqs = [
  {
    question: 'What is MrHustler and how does it work?',
    answer:
      'MrHustler is a Nigerian-focused online earning platform where you complete hustles — like surveys, social media actions, app downloads, and referrals — and get paid directly in Naira. Simply sign up, choose available hustles, complete them, and request a withdrawal.',
  },
  {
    question: 'Is MrHustler free to join?',
    answer:
      'Yes, absolutely. Creating an account on MrHustler costs nothing. There are no hidden fees, no registration charges, and no monthly subscriptions. You earn and keep what you earn.',
  },
  {
    question: 'How quickly are withdrawals processed?',
    answer:
      'Most withdrawals are processed within 2 hours of your request. In rare cases during high-traffic periods, it may take up to 24 hours. We support all major Nigerian banks and fintech wallets including GTB, Access, Kuda, Opay, and Palmpay.',
  },
  {
    question: 'Is there a minimum withdrawal amount?',
    answer:
      'We keep the withdrawal threshold low so you can access your earnings quickly. Once you cross the minimum threshold, you are free to cash out anytime — no questions asked.',
  },
  {
    question: 'How does the referral program work?',
    answer:
      'You get a unique referral link when you sign up. Share it with friends — when they sign up and complete their first hustle, you receive the configured referral bonus. You also earn rewards as your referrals complete hustles.',
  },
  {
    question: 'What types of hustles are available?',
    answer:
      'Hustles include online surveys, social media engagement (likes, follows, shares), app downloads and reviews, data entry, video watching, website visits, account registrations, and much more. New hustles are added daily.',
  },
  {
    question: 'Can I use MrHustler on my phone?',
    answer:
      'Yes! MrHustler is fully mobile-optimized and works on any smartphone browser. You do not need to download an app — just visit our site and start earning immediately from your phone.',
  },
  {
    question: 'Is my personal information safe?',
    answer:
      'We take security very seriously. All data is encrypted using industry-standard SSL. We never sell your personal information to third parties, and your bank details are protected by bank-grade encryption.',
  },
  {
    question: 'What if a hustle I completed was not credited?',
    answer:
      'Our support team is available via live chat, email, or WhatsApp. Share the hustle details and we will investigate.',
  },
  {
    question: 'Are there any age restrictions?',
    answer:
      'You must be at least 18 years old to use MrHustler. We are committed to responsible earning and maintaining a safe platform for all users.',
  },
];

function FAQItem({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`border rounded-2xl transition-all duration-300 overflow-hidden ${
        open ? 'border-amber-400/25 bg-amber-400/3' : 'border-white/6 bg-[#111] hover:border-white/10'
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 p-6 text-left"
      >
        <div className="flex items-center gap-4">
          <span className="text-amber-400/50 text-xs font-black tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className={`font-semibold text-base ${open ? 'text-white' : 'text-gray-200'}`}>
            {question}
          </span>
        </div>
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            open ? 'bg-amber-400/15 text-amber-400' : 'bg-white/5 text-gray-400'
          }`}
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>
      <div
        className={`transition-all duration-300 ${
          open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        } overflow-hidden`}
      >
        <p className="px-6 pb-6 text-gray-400 leading-relaxed text-sm pl-[calc(1.5rem+2rem+1rem)]">
          {answer}
        </p>
      </div>
    </div>
  );
}

export default function FAQ() {
  const contentKeys = faqs.flatMap((_, index) => {
    const key = String(index + 1).padStart(2, '0');
    return [`faq.${key}.question`, `faq.${key}.answer`];
  });
  const content = useSiteContent(contentKeys);
  const visibleFaqs = faqs.map((faq, index) => {
    const key = String(index + 1).padStart(2, '0');
    return {
      question: content[`faq.${key}.question`] || faq.question,
      answer: content[`faq.${key}.answer`] || faq.answer,
    };
  });

  return (
    <section id="faq" className="relative py-28 bg-[#0a0a0a] overflow-hidden">
      <div className="absolute bottom-0 left-1/4 w-[500px] h-[400px] bg-amber-500/3 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block text-amber-400 text-xs font-bold tracking-[0.3em] uppercase mb-4">
            Common Questions
          </span>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-5">
            Answers to Your
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
              Top Questions
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
            We have answered the most common questions from our community. Still
            have doubts? Our team is just a message away.
          </p>
        </div>

        {/* FAQ list */}
        <div className="space-y-3">
          {visibleFaqs.map((faq, i) => (
            <FAQItem key={i} {...faq} index={i} />
          ))}
        </div>

        {/* Still have questions */}
        <div className="mt-12 text-center bg-[#111] border border-white/6 rounded-3xl p-10">
          <h3 className="text-xl font-bold text-white mb-2">Still have questions?</h3>
          <p className="text-gray-400 text-sm mb-6">
            Our friendly support team is available 24/7 to help you via WhatsApp, live chat, or email.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button className="px-6 py-3 rounded-xl bg-green-500/15 hover:bg-green-500/25 text-green-400 font-semibold text-sm border border-green-500/20 transition-colors">
              Chat on WhatsApp
            </button>
            <button className="px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-semibold text-sm border border-white/8 transition-colors">
              Send Email
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
