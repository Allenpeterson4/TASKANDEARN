import { useEffect, useState } from 'react';
import { Activity, CircleDollarSign, Flag, Megaphone, Users, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Metrics = {
  pending_deposits: number;
  approved_deposits: number;
  active_campaigns: number;
  users_online: number;
  registrations_today: number;
  referrals_today: number;
  flagged_withdrawals: number;
  storage_bytes: number;
};

const emptyMetrics: Metrics = { pending_deposits: 0, approved_deposits: 0, active_campaigns: 0, users_online: 0, registrations_today: 0, referrals_today: 0, flagged_withdrawals: 0, storage_bytes: 0 };

export default function AdminMetricsPanel() {
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error: resultError } = await supabase.rpc('admin_dashboard_metrics');
      if (!active) return;
      if (resultError) setError(resultError.message);
      else setMetrics({ ...emptyMetrics, ...(data as Partial<Metrics>) });
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const usedGb = metrics.storage_bytes / (1024 ** 3);
  const storageWarning = usedGb >= 9.6;
  const cards = [
    { label: 'Pending deposits', value: metrics.pending_deposits.toLocaleString(), icon: WalletCards },
    { label: 'Approved deposits', value: `₦${Number(metrics.approved_deposits).toLocaleString('en-NG')}`, icon: CircleDollarSign },
    { label: 'Active campaigns', value: metrics.active_campaigns.toLocaleString(), icon: Megaphone },
    { label: 'Users online', value: metrics.users_online.toLocaleString(), icon: Activity },
    { label: "Today's registrations", value: metrics.registrations_today.toLocaleString(), icon: Users },
    { label: "Today's referrals", value: metrics.referrals_today.toLocaleString(), icon: Users },
    { label: 'Flagged withdrawals', value: metrics.flagged_withdrawals.toLocaleString(), icon: Flag },
  ];

  return (
    <section className="mb-7 space-y-3" aria-label="Live platform metrics">
      {error && <p role="status" className="text-xs text-amber-200">Live metrics unavailable: {error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {cards.map(card => {
          const Icon = card.icon;
          return <article key={card.label} className="border border-white/8 bg-white/[0.025] p-3"><div className="flex items-center justify-between gap-2 text-gray-500"><span className="text-[10px] leading-tight">{card.label}</span><Icon size={14} className="shrink-0 text-emerald-300" /></div><p className="mt-2 truncate text-sm font-bold text-white">{card.value}</p></article>;
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border border-white/8 px-3 py-2 text-xs">
        <span className="text-gray-400">Storage utilization</span>
        <span className="font-semibold text-white">{usedGb.toFixed(2)} GB / 12 GB <span className={storageWarning ? 'text-amber-300' : 'text-emerald-300'}>({storageWarning ? 'Warning' : 'Healthy'})</span></span>
      </div>
    </section>
  );
}
