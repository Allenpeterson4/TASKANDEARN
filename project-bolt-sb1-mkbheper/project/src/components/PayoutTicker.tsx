import { useEffect, useState } from 'react';
import { BadgeCheck, Banknote, Radio } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type PublicPayout = {
  member_label: string;
  amount: number;
  bank_name: string;
  paid_at: string;
};

export default function PayoutTicker() {
  const [payouts, setPayouts] = useState<PublicPayout[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;

    async function refresh() {
      const { data } = await supabase.rpc('get_public_payout_feed');
      if (active && data) setPayouts(data as PublicPayout[]);
    }

    refresh();
    const timer = window.setInterval(refresh, 120000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section aria-label="Verified payouts" className="overflow-hidden border-y border-white/8 bg-[#111] py-4">
      <div className="mx-auto flex max-w-7xl items-center gap-5 px-4 sm:px-6 lg:px-8">
        <div className="flex shrink-0 items-center gap-2 text-emerald-300">
          <Radio size={16} />
          <div><p className="text-[10px] font-bold uppercase tracking-wider">Verified payouts</p><p className="text-[10px] text-gray-500">Opt-in, completed payments</p></div>
        </div>
        <div className="h-9 w-px shrink-0 bg-white/10" />
        {payouts.length ? (
          <div className="flex min-w-0 flex-1 items-center gap-6 overflow-x-auto" aria-live="polite">
            {payouts.map((payout, index) => (
              <div key={`${payout.paid_at}-${index}`} className="flex shrink-0 items-center gap-2 text-xs text-gray-300">
                <BadgeCheck size={14} className="text-emerald-300" />
                <span><strong className="text-white">{payout.member_label}</strong> withdrew <strong className="text-white">₦{Number(payout.amount).toLocaleString('en-NG')}</strong> to {payout.bank_name}</span>
                <span className="text-gray-500">{new Date(payout.paid_at).toLocaleDateString('en-NG')}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-gray-400"><Banknote size={14} />No opted-in verified payouts to display yet.</p>
        )}
      </div>
    </section>
  );
}
