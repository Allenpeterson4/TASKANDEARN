import { useMemo, useState } from 'react';
import { Zap, Clock, ArrowUpRight, ChevronRight, X, BarChart3 } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import type { Balance, Profile, Task, Withdrawal, TaskCompletion } from '@/lib/supabase';
import DailyCheckinCard from './DailyCheckinCard';
import WithdrawalProgressCard from './WithdrawalProgressCard';

interface Props {
  profile: Profile | null;
  balance: Balance | null;
  tasks: Task[];
  completions: TaskCompletion[];
  withdrawals: Withdrawal[];
  referralCount: number;
  userId: string;
  onNavigate: (tab: 'tasks' | 'referral' | 'wallet' | 'plans') => void;
  onBalanceUpdated: (balance: Balance) => void;
}

export default function OverviewPanel({ profile, balance, tasks, completions, withdrawals, referralCount, userId, onNavigate, onBalanceUpdated }: Props) {
  const [chartPeriod, setChartPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const done = completions.filter(c => c.status === 'approved').length;
  const pending = completions.filter(c => c.status === 'pending').length;
  const recentTasks = tasks.slice(0, 4);
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const reminderKey = `hustle-reminder:${profile?.user_id ?? 'hustler'}:${dateKey}`;
  const [reminderDismissed, setReminderDismissed] = useState(() => {
    try {
      return localStorage.getItem(reminderKey) === 'dismissed';
    } catch {
      return false;
    }
  });
  const claimedTaskIds = new Set(completions.filter(completion => completion.status !== 'rejected').map(completion => completion.task_id));
  const availableTaskCount = tasks.filter(task => !claimedTaskIds.has(task.id)).length;
  const availableBalance = (balance?.reward_balance ?? 0) + (balance?.referral_balance ?? 0);
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.full_name?.split(' ')[0] || profile?.username || 'Hustler';
  const hustleBadge = done >= 1000 ? 'President' : done >= 500 ? 'Odogwu Hustler' : done >= 100 ? 'Oga Hustler' : done >= 50 ? 'Street Hustler' : done >= 25 ? 'Pako Hustler' : done >= 10 ? 'Nepo Hustler' : 'Baby Hustler';

  function dismissReminder() {
    setReminderDismissed(true);
    try {
      localStorage.setItem(reminderKey, 'dismissed');
    } catch {
      // Keep dismissal for this session when storage is unavailable.
    }
  }

  const tierProgress: Record<string, { current: number; max: number; next: string }> = {
    Bronze:   { current: done,     max: 10,  next: 'Silver' },
    Silver:   { current: done - 10, max: 20, next: 'Gold' },
    Gold:     { current: done - 30, max: 20, next: 'Platinum' },
    Platinum: { current: done,      max: done, next: 'Max Tier' },
  };
  const tp = tierProgress[profile?.tier ?? 'Bronze'] ?? tierProgress.Bronze;
  const progress = Math.min(100, Math.round((Math.max(0, tp.current) / tp.max) * 100));

  return (
    <div className="space-y-6">
      <section className="flex items-center gap-4" aria-label="Personal greeting">
        {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-12 w-12 rounded-full border border-white/10 object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-300/25 bg-amber-300/10 text-sm font-bold text-amber-200">{firstName.slice(0, 1).toUpperCase()}</div>}
        <div>
          <h2 className="text-lg font-bold text-white">{timeGreeting}, {firstName}</h2>
          <p className="mt-0.5 text-sm text-gray-400">{done > 0 ? `You have ${done} completed hustle${done === 1 ? '' : 's'}. Keep moving.` : 'Complete your first hustle and start earning today.'}</p>
        </div>
      </section>

      <section className="hustler-wallet-card relative isolate overflow-hidden rounded-2xl border border-amber-300/60 bg-gradient-to-br from-[#21190c] via-[#17140f] to-[#10100f] p-4 shadow-[0_0_24px_-8px_rgba(249,115,22,0.7)] sm:p-6" aria-label="Hustler wallet balance">
        <BrandLogo
          className="hustler-wallet-logo pointer-events-none absolute right-3 top-2 z-0 flex h-16 w-16 items-center justify-center opacity-100 sm:right-6 sm:top-3 sm:h-28 sm:w-28"
          markClassName="h-full w-full"
          showWordmark={false}
          showFallback={false}
        />
        <div className="relative z-10 grid min-h-36 grid-cols-[minmax(0,1fr)_auto] grid-rows-[1fr_auto] items-end gap-x-2 gap-y-3 sm:min-h-48 sm:grid-cols-[minmax(0,1fr)_150px] sm:gap-x-5">
          <div className="col-start-1 row-span-2 min-w-0 pb-1">
            <p className="hustler-wallet-title text-xs font-bold uppercase tracking-[0.12em] text-amber-300">Hustler wallet</p>
            <p className="mt-2 text-2xl font-black leading-none text-white sm:text-5xl">₦{availableBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-gray-300/80 sm:mt-4 sm:text-xs">
              <span>Hustles <span className="font-semibold text-white/90">₦{(balance?.reward_balance ?? 0).toLocaleString('en-NG')}</span></span>
              <span>Referrals <span className="font-semibold text-white/90">₦{(balance?.referral_balance ?? 0).toLocaleString('en-NG')}</span></span>
              <span>Lifetime <span className="font-semibold text-white/90">₦{(balance?.total_earned ?? 0).toLocaleString('en-NG')}</span></span>
            </p>
          </div>
          <button onClick={() => onNavigate('wallet')} className="col-start-2 row-start-2 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200/40 bg-amber-400 px-3 py-2.5 text-xs font-bold text-[#21190c] transition-colors hover:bg-amber-300 sm:px-5 sm:py-3 sm:text-sm">
            Open wallet <ArrowUpRight size={16} />
          </button>
        </div>
      </section>

      <WithdrawalProgressCard userId={userId} approvedHustles={done} referralCount={referralCount} tasks={tasks} completions={completions} />
      <DailyCheckinCard userId={userId} firstName={firstName} badge={hustleBadge} onBalanceUpdated={onBalanceUpdated} />

      {/* Available hustles preview */}
      <div className="overflow-hidden rounded-xl border border-white/8 bg-[#111]">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <h3 className="text-sm font-bold text-white">Available Hustles</h3>
          <button onClick={() => onNavigate('tasks')} className="flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300">View all <ChevronRight size={14} /></button>
        </div>
        <div className="divide-y divide-white/8">
          {recentTasks.slice(0, 3).map(task => (
            <div key={task.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-400/10"><Zap size={16} className="text-sky-300" /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-white">{task.title}</p><p className="truncate text-[10px] text-gray-500">{task.category} · {task.difficulty}</p></div>
              <span className="shrink-0 text-xs font-bold text-emerald-400">₦{task.reward.toLocaleString('en-NG')}</span>
              <button onClick={() => onNavigate('tasks')} className="shrink-0 rounded-lg bg-amber-400 px-3 py-2 text-[10px] font-bold text-black">Do Hustle <ArrowUpRight size={12} className="ml-1 inline" /></button>
            </div>
          ))}
          {recentTasks.length === 0 && <p className="px-4 py-6 text-center text-xs text-gray-500">No hustles are available right now.</p>}
        </div>
      </div>

      <PerformanceChart completions={completions} period={chartPeriod} onPeriodChange={setChartPeriod} />

      {availableTaskCount > 0 && !reminderDismissed && (
        <div className="flex items-center justify-between gap-4 border border-orange-400/20 bg-orange-400/5 px-4 py-3">
          <div className="min-w-0"><p className="text-sm font-bold text-orange-200">Your daily hustle reminder</p><p className="mt-0.5 text-xs text-gray-400">{availableTaskCount} available hustle{availableTaskCount === 1 ? '' : 's'} are waiting today.</p></div>
          <button onClick={dismissReminder} aria-label="Dismiss today's hustle reminder" className="shrink-0 p-2 text-gray-400 hover:text-white"><X size={15} /></button>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Hustles Done', value: done, icon: '✅' },
          { label: 'Pending', value: pending, icon: '⏳' },
          { label: 'Withdrawals', value: withdrawals.length, icon: '💸' },
          { label: 'Tier', value: profile?.tier ?? 'Bronze', icon: '🏅' },
        ].map(s => (
          <div key={s.label} className="bg-[#111] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors">
            <span className="text-xl">{s.icon}</span>
            <p className="text-white font-black text-lg mt-1">{s.value}</p>
            <p className="text-gray-500 text-xs">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tier progress */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white font-bold text-sm">Tier Progress</p>
            <p className="text-gray-400 text-xs mt-0.5">{profile?.tier ?? 'Bronze'} → {tp.next}</p>
          </div>
          <span className="text-amber-400 font-black text-sm">{progress}%</span>
        </div>
        <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-gray-500 text-xs mt-2">
          Complete {Math.max(0, tp.max - Math.max(0, tp.current))} more hustles to reach {tp.next}
        </p>
      </div>

      {/* Available hustles preview */}
      <div className="bg-[#111] border border-white/6 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-bold text-sm">Available Hustles</h3>
          <button
            onClick={() => onNavigate('tasks')}
            className="flex items-center gap-1 text-amber-400 text-xs font-semibold hover:text-amber-300 transition-colors"
          >
            View all <ChevronRight size={14} />
          </button>
        </div>
        <div className="divide-y divide-white/4">
          {recentTasks.map(task => (
            <div
              key={task.id}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-white/2 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center flex-shrink-0">
                  <Zap size={14} className="text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">{task.title}</p>
                  <p className="text-gray-500 text-xs">{task.category} · {task.difficulty}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <span className="text-green-400 font-bold text-sm">₦{task.reward.toLocaleString()}</span>
                <ArrowUpRight size={14} className="text-gray-500" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent withdrawals */}
      {withdrawals.length > 0 && (
        <div className="bg-[#111] border border-white/6 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <h3 className="text-white font-bold text-sm">Recent Withdrawals</h3>
            <button
              onClick={() => onNavigate('wallet')}
              className="flex items-center gap-1 text-amber-400 text-xs font-semibold hover:text-amber-300 transition-colors"
            >
              See all <ChevronRight size={14} />
            </button>
          </div>
          <div className="divide-y divide-white/4">
            {withdrawals.slice(0, 3).map(w => (
              <div key={w.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-400/10 flex items-center justify-center">
                    <Clock size={14} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{w.bank_name}</p>
                    <p className="text-gray-500 text-xs">{new Date(w.requested_at).toLocaleDateString('en-NG')}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-bold text-sm">₦{w.amount.toLocaleString()}</p>
                  <span className={`text-xs font-semibold ${
                    w.status === 'approved' ? 'text-green-400' :
                    w.status === 'rejected' ? 'text-red-400' : 'text-amber-400'
                  }`}>
                    {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PerformanceChart({ completions, period, onPeriodChange }: { completions: TaskCompletion[]; period: 'daily' | 'weekly' | 'monthly'; onPeriodChange: (period: 'daily' | 'weekly' | 'monthly') => void }) {
  const points = useMemo(() => {
    const now = new Date();
    const count = period === 'daily' ? 7 : 6;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(now);
      if (period === 'daily') date.setDate(now.getDate() - (count - index - 1));
      if (period === 'weekly') date.setDate(now.getDate() - (count - index - 1) * 7);
      if (period === 'monthly') date.setMonth(now.getMonth() - (count - index - 1));
      const value = completions.filter(completion => {
        if (completion.status === 'rejected') return false;
        const completed = new Date(completion.completed_at);
        if (period === 'daily') return completed.toDateString() === date.toDateString();
        if (period === 'weekly') {
          const weekStart = new Date(date); weekStart.setDate(date.getDate() - date.getDay()); weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
          return completed >= weekStart && completed < weekEnd;
        }
        return completed.getFullYear() === date.getFullYear() && completed.getMonth() === date.getMonth();
      }).length;
      return { label: period === 'monthly' ? date.toLocaleDateString('en-NG', { month: 'short' }) : period === 'weekly' ? `W${index + 1}` : date.toLocaleDateString('en-NG', { weekday: 'short' }), value };
    });
  }, [completions, period]);
  const max = Math.max(1, ...points.map(point => point.value));

  return (
    <div className="bg-[#111] border border-white/6 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-blue-400/10 flex items-center justify-center"><BarChart3 size={17} className="text-blue-400" /></div><div><h3 className="text-white font-bold text-sm">Hustle performance</h3><p className="text-gray-500 text-xs">Completed hustles over time</p></div></div>
        <div className="flex rounded-lg border border-white/8 p-1">{(['daily', 'weekly', 'monthly'] as const).map(value => <button key={value} onClick={() => onPeriodChange(value)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold capitalize ${period === value ? 'bg-blue-400 text-black' : 'text-gray-400 hover:text-white'}`}>{value}</button>)}</div>
      </div>
      <div className="flex h-36 items-end gap-2 sm:gap-4">
        {points.map(point => <div key={point.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] text-gray-400">{point.value}</span><div className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-blue-500 to-cyan-300 transition-all" style={{ height: `${Math.max(8, point.value / max * 100)}%` }} /><span className="text-[10px] text-gray-500">{point.label}</span></div>)}
      </div>
    </div>
  );
}
