import { useEffect, useState } from 'react';
import { CalendarCheck, Loader2 } from 'lucide-react';
import type { Balance } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

type Checkin = { checkin_date: string; streak: number; reward: number };

export default function DailyCheckinCard({ userId, firstName, badge, onBalanceUpdated }: { userId: string; firstName: string; badge: string; onBalanceUpdated: (balance: Balance) => void }) {
  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [claimedToday, setClaimedToday] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    const today = new Date().toISOString().slice(0, 10);
    async function load() {
      const [{ data: latest }, { data: todayRecord }] = await Promise.all([
        supabase.from('daily_checkins').select('checkin_date, streak, reward').eq('user_id', userId).order('checkin_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('daily_checkins').select('checkin_date, streak, reward').eq('user_id', userId).eq('checkin_date', today).maybeSingle(),
      ]);
      if (!active) return;
      setCheckin((todayRecord ?? latest) as Checkin | null);
      setClaimedToday(!!todayRecord);
    }
    void load();
    return () => { active = false; };
  }, [userId]);

  async function claim() {
    setLoading(true);
    setMessage('');
    const { data, error } = await supabase.rpc('claim_daily_checkin');
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    const reward = data as Checkin;
    setCheckin(reward);
    setClaimedToday(true);
    setMessage(`Hi, ${badge.toLowerCase()}, you just earned ₦${Number(reward.reward).toLocaleString()} for checking in and you are on a ${reward.streak}-day streak, ${firstName}.`);
    const { data: balance } = await supabase.from('balances').select('*').eq('user_id', userId).maybeSingle();
    if (balance) onBalanceUpdated(balance as Balance);
    setLoading(false);
  }

  if (claimedToday) return <p role="status" className="text-xs text-orange-200">{message || `Daily hustle check-in claimed. Your current streak is ${checkin?.streak ?? 1} day${checkin?.streak === 1 ? '' : 's'}.`}</p>;

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 border border-orange-400/20 bg-orange-400/[0.04] px-4 py-3" aria-label="Daily hustle check-in">
      <div className="flex items-center gap-3">
        <CalendarCheck size={18} className="shrink-0 text-orange-300" />
        <div>
          <h3 className="text-sm font-bold text-white">Daily check-in</h3>
          <p className="mt-0.5 text-xs text-gray-400">{checkin?.streak ? `${checkin.streak}-day streak so far.` : 'Show up each day to grow your streak.'} Day 7 pays ₦350.</p>
        </div>
      </div>
      <button onClick={claim} disabled={loading} className="flex min-w-32 items-center justify-center gap-2 bg-orange-400 px-4 py-2 text-xs font-bold text-black disabled:opacity-60">
        {loading ? <Loader2 size={14} className="animate-spin" /> : null} Claim check-in
      </button>
      {message && <p role="alert" className="w-full text-xs text-red-300">{message}</p>}
    </section>
  );
}
