import { useEffect, useState } from 'react';
import { Check, Circle, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Task, TaskCompletion } from '@/lib/supabase';

type Settings = {
  hustler_withdrawals_enabled: boolean;
  minimum_hustles: number;
  require_all_hustles: boolean;
  minimum_hustle_level: number;
  minimum_referrals: number;
  minimum_checkin_streak: number;
  minimum_online_minutes: number;
  minimum_interactions: number;
  measurement_days: number;
};

type ActivityRow = { activity_date: string; online_seconds?: number; active_seconds?: number; interactions?: number };
type Requirement = { label: string; value: string; complete: boolean };

const defaults: Settings = {
  hustler_withdrawals_enabled: true,
  minimum_hustles: 0,
  require_all_hustles: false,
  minimum_hustle_level: 0,
  minimum_referrals: 0,
  minimum_checkin_streak: 0,
  minimum_online_minutes: 0,
  minimum_interactions: 0,
  measurement_days: 30,
};

const levels = ['Baby Hustler', 'Nepo Hustler', 'Pako Hustler', 'Street Hustler', 'Oga Hustler', 'Odogwu Hustler', 'President'];

function levelForHustles(count: number) {
  if (count >= 1000) return 6;
  if (count >= 500) return 5;
  if (count >= 100) return 4;
  if (count >= 50) return 3;
  if (count >= 25) return 2;
  if (count >= 10) return 1;
  return 0;
}

export default function WithdrawalProgressCard({ userId, approvedHustles, referralCount, tasks, completions }: {
  userId: string;
  approvedHustles: number;
  referralCount: number;
  tasks: Task[];
  completions: TaskCompletion[];
}) {
  const [settings, setSettings] = useState(defaults);
  const [streak, setStreak] = useState(0);
  const [onlineMinutes, setOnlineMinutes] = useState(0);
  const [interactions, setInteractions] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadRequirements() {
      const [{ data: settingsData }, { data: checkinData }, { data: activityData }] = await Promise.all([
        supabase.from('platform_settings').select('hustler_withdrawals_enabled, minimum_hustles, require_all_hustles, minimum_hustle_level, minimum_referrals, minimum_checkin_streak, minimum_online_minutes, minimum_interactions, measurement_days').eq('singleton', true).maybeSingle(),
        supabase.from('daily_checkins').select('checkin_date, streak').eq('user_id', userId).order('checkin_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('user_activity_daily').select('*').eq('user_id', userId).gte('activity_date', new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)),
      ]);
      if (!active) return;
      if (settingsData) setSettings({ ...defaults, ...settingsData });
      const measurementDays = Number(settingsData?.measurement_days ?? defaults.measurement_days);
      const lastCheckin = checkinData as { checkin_date: string; streak: number } | null;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (lastCheckin && lastCheckin.checkin_date >= yesterday.toISOString().slice(0, 10)) setStreak(Number(lastCheckin.streak));
      const activityRows = (activityData ?? []) as ActivityRow[];
      const cutoff = new Date(Date.now() - measurementDays * 86400000).toISOString().slice(0, 10);
      const measuredRows = activityRows.filter(row => row.activity_date >= cutoff);
      setOnlineMinutes(Math.floor(measuredRows.reduce((total, row) => total + Number(row.online_seconds ?? row.active_seconds ?? 0), 0) / 60));
      setInteractions(measuredRows.reduce((total, row) => total + Number(row.interactions ?? 0), 0));
    }
    void loadRequirements();
    return () => { active = false; };
  }, [userId]);

  const currentLevel = levelForHustles(approvedHustles);
  const approvedTaskIds = new Set(completions.filter(completion => completion.status === 'approved').map(completion => completion.task_id));
  const fundedTasks = tasks.filter(task => task.is_active && task.is_funded);
  const allHustlesComplete = fundedTasks.every(task => approvedTaskIds.has(task.id));
  const requirements: Requirement[] = [];
  if (settings.minimum_hustles > 0) requirements.push({ label: 'Approved hustles', value: `${Math.min(approvedHustles, settings.minimum_hustles)} / ${settings.minimum_hustles}`, complete: approvedHustles >= settings.minimum_hustles });
  if (settings.minimum_hustle_level > 0) requirements.push({ label: 'Hustle level', value: `${levels[currentLevel]} · requires ${levels[Math.min(settings.minimum_hustle_level, levels.length - 1)]}`, complete: currentLevel >= settings.minimum_hustle_level });
  if (settings.minimum_checkin_streak > 0) requirements.push({ label: 'Check-in streak', value: `${Math.min(streak, settings.minimum_checkin_streak)} / ${settings.minimum_checkin_streak} days`, complete: streak >= settings.minimum_checkin_streak });
  if (settings.minimum_referrals > 0) requirements.push({ label: 'Minimum referrals', value: `${Math.min(referralCount, settings.minimum_referrals)} / ${settings.minimum_referrals}`, complete: referralCount >= settings.minimum_referrals });
  if (settings.minimum_online_minutes > 0) requirements.push({ label: 'Online activity', value: `${Math.min(onlineMinutes, settings.minimum_online_minutes)} / ${settings.minimum_online_minutes} min`, complete: onlineMinutes >= settings.minimum_online_minutes });
  if (settings.minimum_interactions > 0) requirements.push({ label: 'Interactions', value: `${Math.min(interactions, settings.minimum_interactions)} / ${settings.minimum_interactions}`, complete: interactions >= settings.minimum_interactions });
  if (settings.require_all_hustles) requirements.push({ label: 'Available hustles', value: `${fundedTasks.filter(task => approvedTaskIds.has(task.id)).length} / ${fundedTasks.length}`, complete: allHustlesComplete });

  const completedCount = requirements.filter(requirement => requirement.complete).length;
  const progress = requirements.length ? Math.round((completedCount / requirements.length) * 100) : settings.hustler_withdrawals_enabled ? 100 : 0;

  return (
    <section className="relative z-20 rounded-xl border border-white/10 bg-[#111] px-4 py-3" aria-label="Withdrawal requirements">
      <div className="flex items-center gap-3">
        <h2 className="shrink-0 text-xs font-semibold text-gray-300 sm:text-sm">Withdrawal Progress</h2>
        <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
        <span className="w-10 shrink-0 text-right text-sm font-bold text-amber-300">{progress}%</span>
        <button type="button" aria-label="View withdrawal requirements" aria-expanded={expanded} onClick={() => setExpanded(current => !current)} className="shrink-0 p-1 text-gray-400 hover:text-white"><Info size={17} /></button>
      </div>
      {expanded && <div className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-2rem))] border border-amber-400/30 bg-[#101010] p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-white">Withdrawal Requirements</h3><p className="mt-1 text-[11px] text-gray-400">Complete the enabled requirements to unlock withdrawal.</p></div><button type="button" onClick={() => setExpanded(false)} aria-label="Close requirements" className="text-gray-500 hover:text-white">×</button></div>
        {!settings.hustler_withdrawals_enabled ? <p className="border-t border-white/8 py-2 text-xs text-red-300">Hustler Wallet withdrawals are currently disabled.</p> : requirements.length === 0 ? <p className="border-t border-white/8 py-2 text-xs text-gray-400">No additional withdrawal requirements are configured.</p> : <ul className="divide-y divide-white/8 border-t border-white/8">{requirements.map(requirement => <li key={requirement.label} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-2 text-gray-300">{requirement.complete ? <Check size={15} className="shrink-0 text-emerald-400" /> : <Circle size={15} className="shrink-0 text-gray-500" />}<span className="truncate">{requirement.label}</span></span><span className={requirement.complete ? 'shrink-0 font-semibold text-emerald-400' : 'shrink-0 font-semibold text-amber-300'}>{requirement.value}</span></li>)}</ul>}
      </div>}
    </section>
  );
}