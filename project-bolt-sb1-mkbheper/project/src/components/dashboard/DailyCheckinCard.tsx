import { useState } from 'react';
import { CalendarCheck, Check, Loader2 } from 'lucide-react';
import type { Balance } from '@/lib/platformTypes';
import { mysqlApi } from '@/lib/platformTypes';
import type { DashboardCheckin } from '@/lib/mysqlApi';

export default function DailyCheckinCard({ userId, firstName, badge, latestCheckin, todayCheckin, onBalanceUpdated }: {
  userId: string;
  firstName: string;
  badge: string;
  latestCheckin: DashboardCheckin | null;
  todayCheckin: DashboardCheckin | null;
  onBalanceUpdated: (balance: Balance) => void;
}) {
  const [checkin, setCheckin] = useState<DashboardCheckin | null>(todayCheckin ?? latestCheckin);
  const [claimedToday, setClaimedToday] = useState(Boolean(todayCheckin));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function claim() {
    setLoading(true);
    setMessage('');
    const { data, error } = await mysqlApi.rpc('claim_daily_checkin');
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    const reward = data as DashboardCheckin;
    setCheckin(reward);
    setClaimedToday(true);
    setMessage(`Hi, ${badge.toLowerCase()}, you just earned ₦${Number(reward.reward).toLocaleString()} for checking in and you are on a ${reward.streak}-day streak, ${firstName}.`);
    const { data: balance } = await mysqlApi.from('balances').select('*').eq('user_id', userId).maybeSingle();
    if (balance) onBalanceUpdated(balance as Balance);
    setLoading(false);
  }

  if (claimedToday) return <div role="status" className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-2 text-xs text-gray-300"><CalendarCheck size={14} className="text-amber-400" /><span>Checked in</span><Check size={13} className="text-emerald-400" /><span className="text-gray-500">{checkin?.streak ?? 1}-day streak</span></div>;

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
