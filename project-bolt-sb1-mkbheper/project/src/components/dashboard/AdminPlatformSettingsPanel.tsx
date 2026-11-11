import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Settings = {
  referral_signup_reward: number;
  referral_first_hustle_reward: number;
  milestone_reward: number;
  hustler_withdrawals_enabled: boolean;
  referral_withdrawals_enabled: boolean;
  withdrawal_failure_message: string;
  minimum_hustles: number;
  require_all_hustles: boolean;
  minimum_hustle_level: number;
  minimum_referrals: number;
  minimum_checkin_streak: number;
  minimum_online_minutes: number;
  minimum_interactions: number;
  measurement_days: number;
  auto_review_mode: 'manual' | 'approve' | 'reject';
  hustler_payout_days: number[];
  hustler_window_start: string;
  hustler_window_end: string;
  hustler_timezone: string;
  referral_payout_days: number[];
  referral_window_start: string;
  referral_window_end: string;
  referral_timezone: string;
};

type Feature = { feature_key: string; free_enabled: boolean; premium_enabled: boolean; settings: { allowed_plan_codes?: string[] } };
type PaidPlan = { plan_code: string; name: string };
type LeaderboardReward = { rank: number; amount: number; enabled: boolean };
const defaults: Settings = { referral_signup_reward: 200, referral_first_hustle_reward: 200, milestone_reward: 2000, hustler_withdrawals_enabled: true, referral_withdrawals_enabled: true, withdrawal_failure_message: 'Your account has not met the withdrawal requirements yet.', minimum_hustles: 0, require_all_hustles: false, minimum_hustle_level: 0, minimum_referrals: 0, minimum_checkin_streak: 0, minimum_online_minutes: 0, minimum_interactions: 0, measurement_days: 30, auto_review_mode: 'manual', hustler_payout_days: [5], hustler_window_start: '14:00', hustler_window_end: '18:00', hustler_timezone: 'Africa/Lagos', referral_payout_days: [5], referral_window_start: '14:00', referral_window_end: '18:00', referral_timezone: 'Africa/Lagos' };
const hustleLevels = ['Baby Hustler', 'Nepo Hustler', 'Pako Hustler', 'Street Hustler', 'Oga Hustler', 'Odogwu Hustler', 'President'];

export default function AdminPlatformSettingsPanel() {
  const [settings, setSettings] = useState(defaults);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [paidPlans, setPaidPlans] = useState<PaidPlan[]>([]);
  const [leaderboardRewards, setLeaderboardRewards] = useState<LeaderboardReward[]>([]);
  const [leaderboardCategory, setLeaderboardCategory] = useState<'earnings' | 'hustles' | 'referrals'>('earnings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([
      supabase.from('platform_settings').select('*').eq('singleton', true).maybeSingle(),
      supabase.from('feature_permissions').select('*').order('feature_key'),
      supabase.from('leaderboard_reward_settings').select('*').order('rank'),
      supabase.from('subscription_plans').select('plan_code, name').eq('is_active', true).gt('price', 0).order('price'),
    ]).then(([settingsResult, featureResult, rewardsResult, plansResult]) => {
      if (settingsResult.error || featureResult.error || rewardsResult.error) setMessage(settingsResult.error?.message ?? featureResult.error?.message ?? rewardsResult.error?.message ?? 'Could not load settings.');
      if (settingsResult.data) setSettings({ ...defaults, ...(settingsResult.data as Settings) });
      setFeatures((featureResult.data ?? []) as Feature[]);
      setLeaderboardRewards((rewardsResult.data ?? []) as LeaderboardReward[]);
      setPaidPlans((plansResult.data ?? []) as PaidPlan[]);
      setLoading(false);
    });
  }, []);

  function updateFeature(index: number, key: 'free_enabled' | 'premium_enabled', checked: boolean) {
    setFeatures(current => current.map((feature, row) => row === index ? { ...feature, [key]: checked } : feature));
  }

  function updateReferralPlan(planCode: string, checked: boolean) {
    setFeatures(current => current.map(feature => {
      if (feature.feature_key !== 'custom-referral-code') return feature;
      const currentCodes = feature.settings.allowed_plan_codes ?? paidPlans.map(plan => plan.plan_code);
      const allowedPlanCodes = checked
        ? [...new Set([...currentCodes, planCode])]
        : currentCodes.filter(code => code !== planCode);
      return { ...feature, settings: { ...feature.settings, allowed_plan_codes: allowedPlanCodes } };
    }));
  }

  function updatePayoutDays(key: 'hustler_payout_days' | 'referral_payout_days', value: string) {
    const days = [...new Set(value.split(',').map(day => Number(day.trim())).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
    setSettings(current => ({ ...current, [key]: days }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings.hustler_payout_days.length || !settings.referral_payout_days.length) {
      setMessage('Choose at least one payout day for each wallet.');
      return;
    }
    if (settings.hustler_window_start >= settings.hustler_window_end || settings.referral_window_start >= settings.referral_window_end) {
      setMessage('Each wallet payout window must end after it starts.');
      return;
    }
    setSaving(true);
    const { data: user } = await supabase.auth.getUser();
    const [settingsResult, ...featureResults] = await Promise.all([
      supabase.from('platform_settings').update({ ...settings, updated_by: user.user?.id, updated_at: new Date().toISOString() }).eq('singleton', true),
      ...features.map(feature => supabase.from('feature_permissions').update({ free_enabled: feature.free_enabled, premium_enabled: feature.premium_enabled, settings: feature.settings, updated_by: user.user?.id, updated_at: new Date().toISOString() }).eq('feature_key', feature.feature_key)),
      ...leaderboardRewards.map(reward => supabase.from('leaderboard_reward_settings').update({ amount: reward.amount, enabled: reward.enabled, updated_by: user.user?.id, updated_at: new Date().toISOString() }).eq('rank', reward.rank)),
    ]);
    const reviewResult = settingsResult.error ? null : await supabase.rpc('admin_set_auto_review_mode', { p_mode: settings.auto_review_mode });
    setSaving(false);
    const error = settingsResult.error ?? featureResults.find(result => result.error)?.error ?? reviewResult?.error;
    setMessage(error ? error.message : settings.auto_review_mode === 'manual' ? 'Platform controls saved.' : `Platform controls saved. ${Number(reviewResult?.data ?? 0)} pending Hustles processed.`);
  }

  async function issueLeaderboardRewards() {
    setSaving(true);
    const now = new Date();
    const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { data, error } = await supabase.rpc('admin_issue_leaderboard_rewards', { p_category: leaderboardCategory, p_period_start: periodStart });
    setSaving(false);
    setMessage(error ? error.message : `Issued rank rewards to ${Number(data ?? 0)} hustlers. This category is locked for the month.`);
  }

  const numberField = (key: 'referral_signup_reward' | 'referral_first_hustle_reward' | 'milestone_reward' | 'minimum_hustles' | 'minimum_hustle_level' | 'minimum_referrals' | 'minimum_checkin_streak' | 'minimum_online_minutes' | 'minimum_interactions' | 'measurement_days', label: string, min = 0, max?: number) => (
    <label key={key} className="block text-xs text-gray-400">{label}<input type="number" min={min} max={max} step="1" value={settings[key]} onChange={event => setSettings(current => ({ ...current, [key]: Number(event.target.value) }))} className="admin-input mt-1" /></label>
  );
  const customReferralFeature = features.find(feature => feature.feature_key === 'custom-referral-code');
  const allowedReferralPlanCodes = customReferralFeature?.settings.allowed_plan_codes ?? paidPlans.map(plan => plan.plan_code);

  return (
    <form onSubmit={save} className="space-y-8">
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}
      {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading platform controls</p> : <>
        <section className="space-y-4">
          <h2 className="font-bold">Reward amounts</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {numberField('referral_signup_reward', 'Per verified signup (NGN)')}
            {numberField('referral_first_hustle_reward', 'When invite completes a hustle (NGN)')}
            {numberField('milestone_reward', 'Every 100 hustles or referrals (NGN)')}
          </div>
        </section>
        <section className="space-y-4 border-t border-white/10 pt-5">
          <h2 className="font-bold">Withdrawal gates</h2>
          <label className="block max-w-sm text-xs text-gray-400">Hustle submission review<select value={settings.auto_review_mode} onChange={event => setSettings(current => ({ ...current, auto_review_mode: event.target.value as Settings['auto_review_mode'] }))} className="admin-input mt-1"><option value="manual">Manual review</option><option value="approve">Automatically approve</option><option value="reject">Automatically reject</option></select></label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {numberField('minimum_hustles', 'Minimum approved hustles')}
            {numberField('minimum_hustle_level', 'Minimum hustle level (0-6)', 0, 6)}
            {numberField('minimum_referrals', 'Minimum referrals')}
            {numberField('minimum_checkin_streak', 'Minimum check-in streak (days)')}
            {numberField('minimum_online_minutes', 'Minimum online minutes in period')}
            {numberField('minimum_interactions', 'Minimum interactions in period')}
            {numberField('measurement_days', 'Measurement period (days)', 1, 365)}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={settings.require_all_hustles} onChange={event => setSettings(current => ({ ...current, require_all_hustles: event.target.checked }))} className="accent-orange-400" />Require all currently available hustles</label>
          <p className="text-xs text-gray-500">Level order: {hustleLevels.join(' · ')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={settings.hustler_withdrawals_enabled} onChange={event => setSettings(current => ({ ...current, hustler_withdrawals_enabled: event.target.checked }))} className="accent-orange-400" />Enable Hustler Wallet withdrawals</label>
            <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={settings.referral_withdrawals_enabled} onChange={event => setSettings(current => ({ ...current, referral_withdrawals_enabled: event.target.checked }))} className="accent-orange-400" />Enable Referral Wallet withdrawals</label>
          </div>
          <div className="grid gap-5 border-t border-white/8 pt-4 lg:grid-cols-2">
            <section className="space-y-3"><h3 className="text-sm font-bold text-white">Hustler Wallet schedule</h3><label className="block text-xs text-gray-400">Weekdays (0 Sunday through 6 Saturday)<input value={settings.hustler_payout_days.join(',')} onChange={event => updatePayoutDays('hustler_payout_days', event.target.value)} className="admin-input mt-1" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs text-gray-400">Opens<input type="time" value={settings.hustler_window_start.slice(0, 5)} onChange={event => setSettings(current => ({ ...current, hustler_window_start: event.target.value }))} className="admin-input mt-1" /></label><label className="text-xs text-gray-400">Closes<input type="time" value={settings.hustler_window_end.slice(0, 5)} onChange={event => setSettings(current => ({ ...current, hustler_window_end: event.target.value }))} className="admin-input mt-1" /></label></div><label className="block text-xs text-gray-400">Time zone<select value={settings.hustler_timezone} onChange={event => setSettings(current => ({ ...current, hustler_timezone: event.target.value }))} className="admin-input mt-1"><option value="Africa/Lagos">Africa/Lagos</option><option value="UTC">UTC</option></select></label></section>
            <section className="space-y-3"><h3 className="text-sm font-bold text-white">Referral Wallet schedule</h3><label className="block text-xs text-gray-400">Weekdays (0 Sunday through 6 Saturday)<input value={settings.referral_payout_days.join(',')} onChange={event => updatePayoutDays('referral_payout_days', event.target.value)} className="admin-input mt-1" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs text-gray-400">Opens<input type="time" value={settings.referral_window_start.slice(0, 5)} onChange={event => setSettings(current => ({ ...current, referral_window_start: event.target.value }))} className="admin-input mt-1" /></label><label className="text-xs text-gray-400">Closes<input type="time" value={settings.referral_window_end.slice(0, 5)} onChange={event => setSettings(current => ({ ...current, referral_window_end: event.target.value }))} className="admin-input mt-1" /></label></div><label className="block text-xs text-gray-400">Time zone<select value={settings.referral_timezone} onChange={event => setSettings(current => ({ ...current, referral_timezone: event.target.value }))} className="admin-input mt-1"><option value="Africa/Lagos">Africa/Lagos</option><option value="UTC">UTC</option></select></label></section>
          </div>
          <label className="block text-xs text-gray-400">Requirement failure message<textarea maxLength={500} rows={3} value={settings.withdrawal_failure_message} onChange={event => setSettings(current => ({ ...current, withdrawal_failure_message: event.target.value }))} className="admin-input mt-1 resize-y" /></label>
        </section>
        <section className="space-y-3 border-t border-white/10 pt-5">
          <h2 className="font-bold">Leaderboard rank rewards</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{leaderboardRewards.map((reward, index) => <div key={reward.rank} className="flex items-center gap-3 border border-white/8 p-3"><span className="w-10 text-xs font-bold text-gray-400">#{reward.rank}</span><input aria-label={`Reward for rank ${reward.rank}`} type="number" min="0" step="100" value={reward.amount} onChange={event => setLeaderboardRewards(current => current.map((item, row) => row === index ? { ...item, amount: Number(event.target.value) } : item))} className="admin-input" /><label className="flex items-center gap-1 text-[10px] text-gray-400"><input type="checkbox" checked={reward.enabled} onChange={event => setLeaderboardRewards(current => current.map((item, row) => row === index ? { ...item, enabled: event.target.checked } : item))} className="accent-orange-400" />On</label></div>)}</div>
          <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-gray-400">Reward category<select value={leaderboardCategory} onChange={event => setLeaderboardCategory(event.target.value as typeof leaderboardCategory)} className="admin-input mt-1"><option value="earnings">Earnings</option><option value="hustles">Completed hustles</option><option value="referrals">Referrals</option></select></label><button type="button" disabled={saving} onClick={() => void issueLeaderboardRewards()} className="bg-orange-400 px-4 py-2.5 text-xs font-bold text-black disabled:opacity-50">{saving ? 'Issuing…' : 'Issue this month’s rewards'}</button><p className="text-xs text-gray-500">Each user can receive one reward per category each month.</p></div>
        </section>
        <section className="space-y-3 border-t border-white/10 pt-5">
          <h2 className="font-bold">Custom referral codes</h2>
          {customReferralFeature ? <>
            <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={customReferralFeature.premium_enabled} onChange={event => updateFeature(features.findIndex(feature => feature.feature_key === 'custom-referral-code'), 'premium_enabled', event.target.checked)} className="accent-orange-400" />Enable custom codes for selected paid plans</label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {paidPlans.map(plan => <label key={plan.plan_code} className="flex items-center gap-2 border border-white/8 px-3 py-2 text-sm text-gray-300"><input type="checkbox" checked={allowedReferralPlanCodes.includes(plan.plan_code)} disabled={!customReferralFeature.premium_enabled} onChange={event => updateReferralPlan(plan.plan_code, event.target.checked)} className="accent-orange-400" />{plan.name}</label>)}
              {paidPlans.length === 0 && <p className="text-xs text-gray-500">Create and activate a paid plan to configure access.</p>}
            </div>
          </> : <p className="text-xs text-gray-500">The custom referral code feature is not configured.</p>}
        </section>
        <section className="space-y-3 border-t border-white/10 pt-5">
          <h2 className="font-bold">Feature permission matrix</h2>
          <div className="overflow-x-auto border-y border-white/8"><table className="w-full min-w-[480px] text-left text-sm"><thead className="text-xs text-gray-500"><tr><th className="py-3">Feature</th><th className="py-3">H. Free</th><th className="py-3">Premium</th></tr></thead><tbody className="divide-y divide-white/8">{features.filter(feature => feature.feature_key !== 'custom-referral-code').map(feature => <tr key={feature.feature_key}><td className="py-3 capitalize">{feature.feature_key.replace(/-/g, ' ')}</td><td className="py-3"><input aria-label={`${feature.feature_key} for free`} type="checkbox" checked={feature.free_enabled} onChange={event => updateFeature(features.indexOf(feature), 'free_enabled', event.target.checked)} className="accent-orange-400" /></td><td className="py-3"><input aria-label={`${feature.feature_key} for premium`} type="checkbox" checked={feature.premium_enabled} onChange={event => updateFeature(features.indexOf(feature), 'premium_enabled', event.target.checked)} className="accent-orange-400" /></td></tr>)}</tbody></table></div>
        </section>
        <button disabled={saving} className="flex items-center gap-2 bg-orange-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}Save controls</button>
      </>}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,146,60,.55)}`}</style>
    </form>
  );
}
