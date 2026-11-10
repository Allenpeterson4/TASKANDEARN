import { useState } from 'react';
import { MessageCircle, Mail, Phone, ChevronDown, ChevronUp, Send, Loader2, CheckCircle } from 'lucide-react';
import { openExternalChat } from '@/lib/externalChat';

const faqs = [
  { q: 'How long does withdrawal take?', a: 'Most withdrawals are processed within 2 hours. During peak periods it may take up to 24 hours.' },
  { q: 'My hustle was not credited — what do I do?', a: 'Contact support with your hustle details and we will investigate.' },
  { q: 'Can I refer more than 50 people?', a: 'Yes! There is no cap. Refer as many as you like and keep earning.' },
  { q: 'What is the minimum withdrawal?', a: 'The minimum withdrawal amount is ₦500.' },
  { q: 'How do I upgrade my tier?', a: 'Your Hustler badge grows as you complete hustles. Referral tiers grow as you invite more hustlers.' },
];

function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-xl overflow-hidden transition-all duration-300 ${open ? 'border-amber-400/20 bg-amber-400/3' : 'border-white/6 bg-[#111] hover:border-white/10'}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left">
        <span className={`font-medium text-sm ${open ? 'text-white' : 'text-gray-200'}`}>{q}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${open ? 'bg-amber-400/15 text-amber-400' : 'bg-white/5 text-gray-400'}`}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>
      {open && <p className="px-5 pb-4 text-gray-400 text-sm leading-relaxed">{a}</p>}
    </div>
  );
}

export default function SupportPanel({ isPremium, prioritySupport }: { isPremium: boolean; prioritySupport: boolean }) {
  const [form, setForm] = useState({ subject: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    setLoading(false);
    setSent(true);
    setForm({ subject: '', message: '' });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {isPremium && prioritySupport && <div className="border border-orange-300/25 bg-orange-300/[0.05] px-4 py-3 text-sm text-orange-100">Premium priority support is active for this account.</div>}
      {/* Contact channels */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { icon: MessageCircle, label: 'Live Chat', sub: isPremium && prioritySupport ? 'Priority response' : 'Avg. response: 5 min', color: 'text-green-400 bg-green-400/10', action: 'Chat Now' },
          { icon: Phone, label: 'Telegram', sub: 'Mon–Sun, 8am–10pm', color: 'text-sky-400 bg-sky-400/10', action: 'Message Us' },
          { icon: Mail, label: 'Email Support', sub: 'Within 24 hours', color: 'text-blue-400 bg-blue-400/10', action: 'Send Email' },
        ].map(ch => {
          const Icon = ch.icon;
          return (
            <div key={ch.label} className="bg-[#111] border border-white/5 rounded-2xl p-5 hover:border-white/10 hover:-translate-y-0.5 transition-all">
              <div className={`w-10 h-10 rounded-xl ${ch.color} flex items-center justify-center mb-3`}>
                <Icon size={18} />
              </div>
              <p className="text-white font-bold text-sm mb-1">{ch.label}</p>
              <p className="text-gray-500 text-xs mb-3">{ch.sub}</p>
              <button onClick={ch.label === 'Live Chat' ? openExternalChat : undefined} className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition-colors">
                {ch.action}
              </button>
            </div>
          );
        })}
      </div>

      {/* Message form */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center">
            <Send size={14} className="text-amber-400" />
          </div>
          <p className="text-white font-bold text-sm">Send a Support Message</p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <CheckCircle size={28} className="text-green-400" />
            </div>
            <p className="text-white font-bold text-lg mb-1">Message Sent!</p>
            <p className="text-gray-400 text-sm mb-5">Our support team will get back to you within 24 hours.</p>
            <button
              onClick={() => setSent(false)}
              className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-semibold transition-colors"
            >
              Send Another
            </button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Subject</label>
              <input
                type="text"
                required
                placeholder="e.g. Hustle not credited"
                value={form.subject}
                onChange={set('subject')}
                className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Message</label>
              <textarea
                required
                rows={5}
                placeholder="Describe your issue in detail..."
                value={form.message}
                onChange={set('message')}
                className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm hover:shadow-lg hover:shadow-amber-500/20 transition-all disabled:opacity-60"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {loading ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}
      </div>

      {/* Mini FAQ */}
      <div>
        <h3 className="text-white font-bold text-sm mb-3">Quick Answers</h3>
        <div className="space-y-2">
          {faqs.map(faq => <FAQ key={faq.q} {...faq} />)}
        </div>
      </div>
    </div>
  );
}
