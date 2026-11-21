import { useState, useEffect } from 'react';
import type { AppUser, DashboardSettings, DashboardSnapshot } from '@/lib/mysqlApi';
import { ClipboardList, History } from 'lucide-react';
import { mysqlApi } from '@/lib/platformTypes';
import type { Profile, Balance, Task, TaskCompletion, Referral, Withdrawal } from '@/lib/platformTypes';
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
  user: AppUser;
}

function getFeatureAccess(settings: DashboardSettings): Record<string, boolean> {
  const premium = settings.current_plan_code !== 'free';
  return Object.fromEntries(settings.feature_permissions.map(feature => {
    const enabled = feature.feature_key === 'custom-referral-code'
      ? premium && feature.premium_enabled && (!feature.settings?.allowed_plan_codes || feature.settings.allowed_plan_codes.includes(settings.current_plan_code))
      : premium ? feature.premium_enabled : feature.free_enabled;
    return [feature.feature_key, enabled];
  }));
}

export default function Dashboard({ user }: Props) {
  const [tab, setTab] = useState<DashTab>('overview');
  const [hustleView, setHustleView] = useState<'available' | 'history'>('available');
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
  const [dashboardReady, setDashboardReady] = useState(false);
  const [withdrawalSettings, setWithdrawalSettings] = useState<DashboardSnapshot['withdrawal_settings']>(null);
  const [latestCheckin, setLatestCheckin] = useState<DashboardSnapshot['latest_checkin']>(null);
  const [todayCheckin, setTodayCheckin] = useState<DashboardSnapshot['today_checkin']>(null);
  const [activityRows, setActivityRows] = useState<DashboardSnapshot['activity']>([]);
  const [announcement, setAnnouncement] = useState<DashboardSnapshot['announcement']>(null);
  const [welcomeBonusClaimed, setWelcomeBonusClaimed] = useState(false);
  const [dashboardAdvertisement, setDashboardAdvertisement] = useState<DashboardSnapshot['advertisement']>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const { data: snapshot, error } = await mysqlApi.dashboard.load();
        if (!active) return;
        if (error || !snapshot) {
          setLoadError(error?.message ?? 'Dashboard data is temporarily unavailable. Please retry.');
          return;
        }
        setProfile(snapshot.profile as Profile | null);
        setBalance(snapshot.balance as Balance | null);
        setTasks(snapshot.tasks as Task[]);
        setCompletions(snapshot.completions);
        setReferrals(snapshot.referrals as Referral[]);
        setWithdrawals(snapshot.withdrawals as Withdrawal[]);
        setFundingDeposits(snapshot.funding_deposits as typeof fundingDeposits);
        setAvailablePlanCodes(snapshot.available_plan_codes);
        setCurrentPlanCode(snapshot.current_plan_code);
        setFeatureAccess(getFeatureAccess(snapshot));
        setWithdrawalSettings(snapshot.withdrawal_settings);
        setLatestCheckin(snapshot.latest_checkin);
        setTodayCheckin(snapshot.today_checkin);
        setActivityRows(snapshot.activity);
        setAnnouncement(snapshot.announcement);
        setWelcomeBonusClaimed(snapshot.announcement_claimed);
        setDashboardAdvertisement(snapshot.advertisement);
        setShowModal(Boolean(snapshot.announcement?.enabled));
        setDashboardReady(true);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : 'Dashboard data could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [loadAttempt, user.id]);

  useEffect(() => {
    const featureByTab: Partial<Record<DashTab, string>> = { tasks: 'hustles', referral: 'referrals', leaderboard: 'leaderboard' };
    const feature = featureByTab[tab];
    if (feature && featureAccess[feature] === false) setTab('overview');
  }, [featureAccess, tab]);

  useEffect(() => {
    if (!dashboardReady) return;
    let active = true;
    async function refreshPlanAvailability() {
      const { data, error } = await mysqlApi.dashboard.settings();
      if (!active) return;
      if (error) {
        setLoadError(error.message);
        return;
      }
      if (!data) return;
      setAvailablePlanCodes(data.available_plan_codes);
      setCurrentPlanCode(data.current_plan_code);
      setFeatureAccess(getFeatureAccess(data));
    }
    const refresh = () => { void refreshPlanAvailability(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [dashboardReady, user.id]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await mysqlApi.auth.signOut();
    } catch (error) {
      setLoadError(`Sign out failed: ${error instanceof Error ? error.message : 'Please try again.'}`);
      setLoggingOut(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <BrandLogo className="site-brand-image h-14 w-48" imageOnly showFallback={false} />
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
          announcement={announcement}
          alreadyClaimed={welcomeBonusClaimed}
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
        loggingOut={loggingOut}
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
            {loadError && (
              <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
                <p>Dashboard data could not be loaded: {loadError}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-200">Retry</button>
                  <button type="button" onClick={() => void handleLogout()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-200">Sign out to login</button>
                </div>
              </div>
            )}
            <DashboardAdBanner advertisement={dashboardAdvertisement} />
            {tab === 'overview' && (
              <OverviewPanel
                profile={profile}
                balance={balance}
                tasks={tasks}
                completions={completions}
                withdrawals={withdrawals}
                withdrawalSettings={withdrawalSettings}
                latestCheckin={latestCheckin}
                todayCheckin={todayCheckin}
                activityRows={activityRows}
                referralCount={referrals.length}
                userId={user.id}
                onNavigate={tabName => setTab(tabName)}
                onBalanceUpdated={nextBalance => setBalance(nextBalance)}
              />
            )}
            {tab === 'tasks' && (
              <>
                <div role="tablist" aria-label="Hustle views" className="mb-5 inline-flex rounded-xl bg-[#111] p-1">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={hustleView === 'available'}
                    aria-controls="hustles-view-panel"
                    onClick={() => setHustleView('available')}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${hustleView === 'available' ? 'bg-amber-400 text-black' : 'text-gray-400 hover:text-white'}`}
                  >
                    <ClipboardList size={16} /> Hustles
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={hustleView === 'history'}
                    aria-controls="hustles-view-panel"
                    onClick={() => setHustleView('history')}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${hustleView === 'history' ? 'bg-amber-400 text-black' : 'text-gray-400 hover:text-white'}`}
                  >
                    <History size={16} /> Hustle history
                  </button>
                </div>
                <div role="tabpanel" id="hustles-view-panel">
                  {hustleView === 'available' ? (
                    <TasksPanel
                      tasks={tasks}
                      completions={completions}
                      userId={user.id}
                      currentPlanCode={currentPlanCode}
                      availablePlanCodes={availablePlanCodes}
                      allowCampaigns={featureAccess.campaigns !== false}
                      onUpgrade={() => setTab('plans')}
                      onCompletionAdded={c => setCompletions(previous => [...previous, c])}
                      onBalanceUpdated={nextBalance => setBalance(current => current ? { ...current, ...nextBalance } : current)}
                    />
                  ) : <TaskHistoryPanel tasks={tasks} completions={completions} />}
                </div>
              </>
            )}
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
                profileLoadError={loadError}
                onRetryProfile={() => setLoadAttempt(attempt => attempt + 1)}
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
