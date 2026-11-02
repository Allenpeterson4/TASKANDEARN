import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, Balance, Task, TaskCompletion, Referral, Withdrawal } from '@/lib/supabase';
import DashSidebar, { DashTopbar, type DashTab } from './DashSidebar';
import WelcomeModal from './WelcomeModal';
import OverviewPanel from './OverviewPanel';
import TasksPanel from './TasksPanel';
import ReferralPanel from './ReferralPanel';
import WithdrawalPanel from './WithdrawalPanel';
import ProfilePanel from './ProfilePanel';
import SupportPanel from './SupportPanel';
import SubscriptionPanel from './SubscriptionPanel';

interface Props {
  user: User;
}

export default function Dashboard({ user }: Props) {
  const [tab, setTab] = useState<DashTab>('overview');
  const [sideOpen, setSideOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completions, setCompletions] = useState<TaskCompletion[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [currentPlanCode, setCurrentPlanCode] = useState('free');
  const [availablePlanCodes, setAvailablePlanCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [
        { data: prof },
        { data: bal },
        { data: taskList },
        { data: comps },
        { data: refs },
        { data: wds },
        { data: paidPlans },
        { data: activeSubscription },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('balances').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('tasks').select('*').eq('is_active', true).order('sort_order').order('created_at', { ascending: false }),
        supabase.from('task_completions').select('*').eq('user_id', user.id),
        supabase.from('referrals').select('*').eq('referrer_id', user.id),
        supabase.from('withdrawals').select('*').eq('user_id', user.id).order('requested_at', { ascending: false }),
        supabase.from('subscription_plans').select('plan_code').eq('is_active', true).gt('price', 0),
        supabase.from('user_subscriptions').select('plan_code').eq('user_id', user.id).eq('status', 'active').gt('ends_at', new Date().toISOString()).order('starts_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setProfile(prof ?? null);
      setBalance(bal ?? null);
      setTasks(taskList ?? []);
      setCompletions(comps ?? []);
      setReferrals(refs ?? []);
      setWithdrawals(wds ?? []);
      const activePlanCodes = (paidPlans ?? []).map(plan => plan.plan_code);
      setAvailablePlanCodes(activePlanCodes);
      setCurrentPlanCode(activeSubscription?.plan_code ?? 'free');
      setLoading(false);
      setShowModal(true);
    }
    load();
  }, [user.id]);

  useEffect(() => {
    let active = true;
    async function refreshPlanAvailability() {
      const [{ data: plans }, { data: subscription }] = await Promise.all([
        supabase.from('subscription_plans').select('plan_code').eq('is_active', true).gt('price', 0),
        supabase.from('user_subscriptions').select('plan_code').eq('user_id', user.id).eq('status', 'active').gt('ends_at', new Date().toISOString()).order('starts_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (active) {
        setAvailablePlanCodes((plans ?? []).map(plan => plan.plan_code));
        setCurrentPlanCode(subscription?.plan_code ?? 'free');
      }
    }
    const refresh = () => { void refreshPlanAvailability(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [user.id]);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center animate-pulse">
            <span className="text-white font-black text-2xl">M</span>
          </div>
          <p className="text-gray-400 text-sm">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  if (profile?.account_status && profile.account_status !== 'active') {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-white text-2xl font-black">Account {profile.account_status}</h1>
          <p className="mt-3 text-gray-400">{profile.status_reason || 'Please contact support if you believe this is a mistake.'}</p>
          <button onClick={handleLogout} className="mt-6 rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5">Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex">
      {showModal && (
        <WelcomeModal
          onClose={() => setShowModal(false)}
          fullName={profile?.full_name}
        />
      )}

      <DashSidebar
        active={tab}
        onChange={setTab}
        fullName={profile?.full_name ?? user.email?.split('@')[0] ?? 'Hustler'}
        tier={profile?.tier ?? 'Bronze'}
        onLogout={handleLogout}
        taskCount={tasks.length}
        showPlans={availablePlanCodes.length > 0}
        sideOpen={sideOpen}
        setSideOpen={setSideOpen}
      />

      {/* Main content */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <DashTopbar
          onMenuClick={() => setSideOpen(true)}
          onNotif={() => setShowModal(true)}
          tab={tab}
        />

        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
          <div className="max-w-5xl mx-auto">
            {tab === 'overview' && (
              <OverviewPanel
                profile={profile}
                balance={balance}
                tasks={tasks}
                completions={completions}
                withdrawals={withdrawals}
                onNavigate={(t) => setTab(t)}
              />
            )}
            {tab === 'tasks' && (
              <TasksPanel
                tasks={tasks}
                completions={completions}
                userId={user.id}
                currentPlanCode={currentPlanCode}
                availablePlanCodes={availablePlanCodes}
                onUpgrade={() => setTab('plans')}
                onCompletionAdded={(c) => setCompletions(prev => [...prev, c])}
              />
            )}
            {tab === 'referral' && (
              <ReferralPanel
                profile={profile}
                balance={balance}
                referrals={referrals}
              />
            )}
            {tab === 'withdrawal' && (
              <WithdrawalPanel
                balance={balance}
                withdrawals={withdrawals}
                onWithdrawalAdded={(w) => setWithdrawals(prev => [w, ...prev])}
              />
            )}
            {tab === 'profile' && (
              <ProfilePanel
                profile={profile}
                email={user.email ?? ''}
                onProfileUpdated={(p) => setProfile(p)}
              />
            )}
            {tab === 'plans' && <SubscriptionPanel userId={user.id} />}
            {tab === 'support' && <SupportPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}
