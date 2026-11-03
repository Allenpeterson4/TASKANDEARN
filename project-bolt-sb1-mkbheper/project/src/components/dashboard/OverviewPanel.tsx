import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Zap, Users, Clock, ArrowUpRight, ChevronRight, X, BarChart3, ArrowRightLeft, Loader2 } from 'lucide-react';
import type { Balance, Profile, Task, Withdrawal, TaskCompletion } from '@/lib/supabase';

interface Props {
  profile: Profile | null;
  balance: Balance | null;
  tasks: Task[];
  completions: TaskCompletion[];
  withdrawals: Withdrawal[];
  onNavigate: (tab: 'tasks' | 'referral' | 'withdrawal' | 'plans' | 'funding') => void;
  onTransferReferral: () => Promise<void>;
}

function BalanceCard({
  label, value, icon, color, sub, actions,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`relative bg-[#111] border rounded-2xl p-5 overflow-hidden border-white/6 hover:border-white/10 transition-all duration-300`}>
      <div className={`absolute -top-6 -right-6 w-20 h-20 ${color} rounded-full blur-xl opacity-30`} />
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl ${color} bg-opacity-15 flex items-center justify-center`}>
          {icon}
        </div>
        <TrendingUp size={14} className="text-green-400 opacity-60" />
      </div>
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className="text-white text-2xl font-black">₦{value.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
      {actions}
    </div>
  );
}

export default function OverviewPanel({ profile, balance, tasks, completions, withdrawals, onNavigate, onTransferReferral }: Props) {
  const greetings = [
    'Your consistency is building real momentum.',
    'Small tasks today can create a stronger tomorrow.',
    'You are closer to your next milestone than you think.',
    'Every verified task is a step toward your goals.',
    'Your effort is adding up. Keep the streak alive.',
    'There is more earning potential waiting in your task list.',
    'Progress looks good on you. Keep moving forward.',
    'Your next win could be one completed task away.',
    'Smart effort compounds. Make today count.',
    'You showed up. Now turn that energy into earnings.',
  ];
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [chartPeriod, setChartPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [transferring, setTransferring] = useState(false);
  const [transferMessage, setTransferMessage] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setGreetingIndex(current => (current + 1) % greetings.length), 5000);
    return () => window.clearInterval(timer);
  }, [greetings.length]);

  async function transferReferralEarnings() {
    setTransferring(true);
    setTransferMessage('');
    try {
      await onTransferReferral();
      setTransferMessage('Transferred to reward balance.');
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : 'Transfer failed.');
    } finally {
      setTransferring(false);
    }
  }

  const done = completions.filter(c => c.status === 'approved').length;
  const pending = completions.filter(c => c.status === 'pending').length;
  const recentTasks = tasks.slice(0, 4);
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const reminderKey = `task-reminder:${profile?.user_id ?? 'member'}:${dateKey}`;
  const [reminderDismissed, setReminderDismissed] = useState(() => {
    try {
      return localStorage.getItem(reminderKey) === 'dismissed';
    } catch {
      return false;
    }
  });
  const claimedTaskIds = new Set(completions.filter(completion => completion.status !== 'rejected').map(completion => completion.task_id));
  const availableTaskCount = tasks.filter(task => !claimedTaskIds.has(task.id)).length;

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
      {availableTaskCount > 0 && !reminderDismissed && (
        <div className="flex items-center justify-between gap-4 border border-emerald-400/20 bg-emerald-400/5 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-emerald-300">Your daily task reminder</p>
            <p className="mt-0.5 text-xs text-gray-400">{availableTaskCount} available task{availableTaskCount === 1 ? '' : 's'} are waiting today.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => onNavigate('tasks')} className="rounded border border-emerald-300/25 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-300/10">View tasks</button>
            <button onClick={dismissReminder} aria-label="Dismiss today's task reminder" className="p-2 text-gray-400 hover:text-white"><X size={15} /></button>
          </div>
        </div>
      )}

      {/* Welcome banner */}
      <div className="relative bg-gradient-to-r from-amber-400/10 via-orange-500/5 to-transparent border border-amber-400/12 rounded-2xl p-5 overflow-hidden">
        <div className="absolute -right-8 -top-8 w-40 h-40 bg-amber-400/5 rounded-full blur-xl" />
        <div className="relative">
          <p className="text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
            Hello, {profile?.full_name?.split(' ')[0] || 'Hustler'} 👋
          </p>
          <h2 className="dashboard-greeting text-xl font-black mb-1">
            {greetings[greetingIndex]}
          </h2>
          <p className="text-gray-400 text-sm">
            {done > 0
              ? `You've completed ${done} task${done > 1 ? 's' : ''}. Keep going!`
              : 'Complete your first task and start earning real Naira today.'}
          </p>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BalanceCard
          label="Reward Balance"
          value={balance?.reward_balance ?? 0}
          icon={<Zap size={18} className="text-amber-400" />}
          color="bg-amber-400"
          sub="From completed tasks"
          actions={<div className="mt-4 flex gap-2"><button onClick={() => onNavigate('withdrawal')} className="flex-1 rounded-lg border border-amber-400/25 px-2 py-2 text-[11px] font-bold text-amber-300 hover:bg-amber-400/10">Withdraw</button><button onClick={() => onNavigate('funding')} className="flex-1 rounded-lg bg-amber-400 px-2 py-2 text-[11px] font-bold text-black hover:bg-amber-300">Fund Account</button></div>}
        />
        <BalanceCard
          label="Referral Balance"
          value={balance?.referral_balance ?? 0}
          icon={<Users size={18} className="text-green-400" />}
          color="bg-green-400"
          sub="From referred members"
          actions={<><button onClick={transferReferralEarnings} disabled={transferring || (balance?.referral_balance ?? 0) <= 0} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-green-400/25 px-2 py-2 text-[11px] font-bold text-green-300 hover:bg-green-400/10 disabled:opacity-50">{transferring ? <Loader2 size={13} className="animate-spin" /> : <ArrowRightLeft size={13} />}{transferring ? 'Transferring...' : 'Transfer Earnings'}</button>{transferMessage && <p className="mt-2 text-[10px] text-green-300">{transferMessage}</p>}</>}
        />
        <BalanceCard
          label="Total Earned"
          value={balance?.total_earned ?? 0}
          icon={<TrendingUp size={18} className="text-blue-400" />}
          color="bg-blue-400"
          sub="All-time earnings"
        />
      </div>

      <PerformanceChart completions={completions} period={chartPeriod} onPeriodChange={setChartPeriod} />

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Tasks Done', value: done, icon: '✅' },
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
          Complete {Math.max(0, tp.max - Math.max(0, tp.current))} more tasks to reach {tp.next}
        </p>
      </div>

      {/* Available tasks preview */}
      <div className="bg-[#111] border border-white/6 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-bold text-sm">Available Tasks</h3>
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
              onClick={() => onNavigate('withdrawal')}
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
        <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-blue-400/10 flex items-center justify-center"><BarChart3 size={17} className="text-blue-400" /></div><div><h3 className="text-white font-bold text-sm">Task performance</h3><p className="text-gray-500 text-xs">Completed tasks over time</p></div></div>
        <div className="flex rounded-lg border border-white/8 p-1">{(['daily', 'weekly', 'monthly'] as const).map(value => <button key={value} onClick={() => onPeriodChange(value)} className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold capitalize ${period === value ? 'bg-blue-400 text-black' : 'text-gray-400 hover:text-white'}`}>{value}</button>)}</div>
      </div>
      <div className="flex h-36 items-end gap-2 sm:gap-4">
        {points.map(point => <div key={point.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] text-gray-400">{point.value}</span><div className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-blue-500 to-cyan-300 transition-all" style={{ height: `${Math.max(8, point.value / max * 100)}%` }} /><span className="text-[10px] text-gray-500">{point.label}</span></div>)}
      </div>
    </div>
  );
}
