import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, Balance, Task, TaskCompletion, Referral, Withdrawal } from '@/lib/supabase';
import DashSidebar, { DashTopbar, type DashTab } from './DashSidebar';
import AnnouncementModal from './AnnouncementModal';
import OverviewPanel from './OverviewPanel';
import TasksPanel from './TasksPanel';
import ReferralPanel from './ReferralPanel';
import WalletPanel from './WalletPanel';
import ProfilePanel from './ProfilePanel';
import SupportPanel from './SupportPanel';
import SubscriptionPanel from './SubscriptionPanel';
import PaymentSelectionPanel from './PaymentSelectionPanel';
import NotificationsPanel from './NotificationsPanel';
import TaskHistoryPanel from './TaskHistoryPanel';
import ActivityTracker from './ActivityTracker';
import DashboardAdBanner from './DashboardAdBanner';
import LeaderboardPanel from './LeaderboardPanel';
import BrandLogo from '@/components/BrandLogo';

interface Props {
  user: User;
}

export default function Dashboard({ user }: Props) {
  const [tab, setTab] = useState<DashTab>('overview');
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completions, setCompletions] = useState<TaskCompletion[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [fundingDeposits, setFundingDeposits] = useState<{ id: string; amount: number; status: string; created_at: string }[]>([]);
  const [currentPlanCode, setCurrentPlanCode] = useState('free');
  const [availablePlanCodes, setAvailablePlanCodes] = useState<string[]>([]);
  const [featureAccess, setFeatureAccess] = useState<Record<string, boolean>>({});
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
        { data: deposits },
        { data: paidPlans },
        { data: activeSubscription },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('balances').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('tasks').select('*').eq('is_active', true).order('sort_order').order('created_at', { ascending: false }),
        supabase.from('task_completions').select('*').eq('user_id', user.id),
        supabase.from('referrals').select('*').eq('referrer_id', user.id),
        supabase.from('withdrawals').select('*').eq('user_id', user.id).order('requested_at', { ascending: false }),
        supabase.from('funding_deposits').select('id, amount, status, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('subscription_plans').select('plan_code').eq('is_active', true).gt('price', 0),
        supabase.from('user_subscriptions').select('plan_code').eq('user_id', user.id).eq('status', 'active').or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).order('starts_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setProfile(prof ?? null);
      setBalance(bal ?? null);
      setTasks(taskList ?? []);
      setCompletions(comps ?? []);
      setReferrals(refs ?? []);
      setWithdrawals(wds ?? []);
      setFundingDeposits(deposits ?? []);
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
    supabase.from('feature_permissions').select('feature_key, free_enabled, premium_enabled').then(({ data }) => {
      if (!active) return;
      const premium = currentPlanCode !== 'free';
      setFeatureAccess(Object.fromEntries((data ?? []).map(feature => [feature.feature_key, premium ? feature.premium_enabled : feature.free_enabled])));
    });
    return () => { active = false; };
  }, [currentPlanCode]);

  useEffect(() => {
    const featureByTab: Partial<Record<DashTab, string>> = { tasks: 'hustles', referral: 'referrals', leaderboard: 'leaderboard' };
    const feature = featureByTab[tab];
    if (feature && featureAccess[feature] === false) setTab('overview');
  }, [featureAccess, tab]);

  useEffect(() => {
    let active = true;
    async function refreshPlanAvailability() {
      const [{ data: plans }, { data: subscription }] = await Promise.all([
        supabase.from('subscription_plans').select('plan_code').eq('is_active', true).gt('price', 0),
        supabase.from('user_subscriptions').select('plan_code').eq('user_id', user.id).eq('status', 'active').or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).order('starts_at', { ascending: false }).limit(1).maybeSingle(),
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
          <BrandLogo className="animate-pulse" showWordmark={false} markClassName="h-14 w-14 overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center" fallbackClassName="text-white font-black text-2xl" />
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
      <ActivityTracker userId={user.id} />
      {showModal && (
        <AnnouncementModal
          userId={user.id}
          onClose={() => setShowModal(false)}
          onClaimOffer={() => { setShowModal(false); setTab('tasks'); }}
          onBalanceUpdated={nextBalance => setBalance(nextBalance)}
          fullName={profile?.full_name}
        />
      )}

      <DashSidebar
        active={tab}
        onChange={setTab}
        fullName={profile?.full_name ?? user.email?.split('@')[0] ?? 'Hustler'}
        avatarUrl={profile?.avatar_url ?? null}
        tier={profile?.tier ?? 'Bronze'}
        onLogout={handleLogout}
        taskCount={tasks.length}
        showPlans={availablePlanCodes.length > 0}
        featureAccess={featureAccess}
        sideOpen={sideOpen}
        setSideOpen={setSideOpen}
      />

      {/* Main content */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <DashTopbar
          onMenuClick={() => setSideOpen(true)}
          onNotif={() => setShowNotifications(current => !current)}
          tab={tab}
        />
        {showNotifications && <NotificationsPanel completions={completions} withdrawals={withdrawals} deposits={fundingDeposits} onClose={() => setShowNotifications(false)} />}

        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
          <div className="max-w-5xl mx-auto">
            <DashboardAdBanner />
            {tab === 'overview' && (
              <OverviewPanel
                profile={profile}
                balance={balance}
                tasks={tasks}
                completions={completions}
                withdrawals={withdrawals}
                userId={user.id}
                onNavigate={tabName => setTab(tabName)}
                onBalanceUpdated={nextBalance => setBalance(nextBalance)}
              />
            )}
            {tab === 'tasks' && (
              <TasksPanel
                tasks={tasks}
                completions={completions}
                userId={user.id}
                currentPlanCode={currentPlanCode}
                availablePlanCodes={availablePlanCodes}
                allowCampaigns={featureAccess.campaigns !== false}
                onUpgrade={() => setTab('plans')}
                onCompletionAdded={(c) => setCompletions(prev => [...prev, c])}
                onBalanceUpdated={(nextBalance) => setBalance(current => current ? { ...current, ...nextBalance } : current)}
              />
            )}
            {tab === 'history' && <TaskHistoryPanel tasks={tasks} completions={completions} />}
            {tab === 'referral' && (
              <ReferralPanel
                profile={profile}
                balance={balance}
                referrals={referrals}
                isPremium={currentPlanCode !== 'free'}
                allowCustomReferralCode={featureAccess['custom-referral-code'] !== false}
                onProfileUpdated={nextProfile => setProfile(nextProfile)}
                onBalanceUpdated={(nextBalance) => setBalance(nextBalance)}
              />
            )}
            {tab === 'wallet' && (
              <WalletPanel
                profile={profile}
                balance={balance}
                referrals={referrals}
                withdrawals={withdrawals}
                userId={user.id}
                currentPlanCode={currentPlanCode}
                allowTransfers={featureAccess.transfers !== false}
                allowCustomReferralCode={featureAccess['custom-referral-code'] !== false}
                onWithdrawalAdded={withdrawal => setWithdrawals(previous => [withdrawal, ...previous])}
                onBalanceUpdated={nextBalance => setBalance(nextBalance)}
                onProfileUpdated={nextProfile => setProfile(nextProfile)}
              />
            )}
            {tab === 'leaderboard' && <LeaderboardPanel userId={user.id} />}
            {tab === 'profile' && (
              <ProfilePanel
                profile={profile}
                email={user.email ?? ''}
                approvedHustles={completions.filter(completion => completion.status === 'approved').length}
                currentPlanCode={currentPlanCode}
                onProfileUpdated={(p) => setProfile(p)}
              />
            )}
            {tab === 'plans' && <SubscriptionPanel userId={user.id} onSelectPlan={(planCode) => { setSelectedPlanCode(planCode); setTab('payment'); }} />}
            {tab === 'payment' && selectedPlanCode && <PaymentSelectionPanel planCode={selectedPlanCode} onBack={() => setTab('plans')} />}
            {tab === 'support' && <SupportPanel isPremium={currentPlanCode !== 'free'} prioritySupport={featureAccess['priority-support'] !== false} />}
          </div>
        </main>
      </div>
    </div>
  );
}
