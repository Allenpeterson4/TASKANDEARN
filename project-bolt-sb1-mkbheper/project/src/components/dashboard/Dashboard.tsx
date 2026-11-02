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
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('balances').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('tasks').select('*').eq('is_active', true).order('created_at', { ascending: false }),
        supabase.from('task_completions').select('*').eq('user_id', user.id),
        supabase.from('referrals').select('*').eq('referrer_id', user.id),
        supabase.from('withdrawals').select('*').eq('user_id', user.id).order('requested_at', { ascending: false }),
      ]);
      setProfile(prof ?? null);
      setBalance(bal ?? null);
      setTasks(taskList ?? []);
      setCompletions(comps ?? []);
      setReferrals(refs ?? []);
      setWithdrawals(wds ?? []);
      setLoading(false);

      // Show welcome modal for brand new users (no completions yet)
      if (!comps || comps.length === 0) {
        setTimeout(() => setShowModal(true), 800);
      }
    }
    load();
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
                userId={user.id}
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
            {tab === 'support' && <SupportPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}
