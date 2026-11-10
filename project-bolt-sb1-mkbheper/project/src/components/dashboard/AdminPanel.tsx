import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileText,
  History,
  ExternalLink,
  Loader2,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Shuffle,
  Trash2,
  Users,
  X,
  Package,
  MessageCircle,
  Image,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Megaphone,
} from 'lucide-react';
import { supabase, type Profile, type Task, type TaskCompletion, type Withdrawal } from '@/lib/supabase';
import ThemeToggle from '@/components/ThemeToggle';
import AdminActivityPanel from './AdminActivityPanel';
import AdminContentPanel from './AdminContentPanel';
import AdminPlansPanel from './AdminPlansPanel';
import AdminPayoutSettingsPanel from './AdminPayoutSettingsPanel';
import AdminSubscriptionReviewPanel from './AdminSubscriptionReviewPanel';
import AdminFundingPanel from './AdminFundingPanel';
import AdminSupportSettingsPanel from './AdminSupportSettingsPanel';
import AdminMetricsPanel from './AdminMetricsPanel';
import AdminAdBannerPanel from './AdminAdBannerPanel';
import AdminPlatformSettingsPanel from './AdminPlatformSettingsPanel';
import AdminCampaignPanel from './AdminCampaignPanel';
import AdminAnnouncementPanel from './AdminAnnouncementPanel';
import AdminBrandingPanel from './AdminBrandingPanel';

type Section = 'tasks' | 'users' | 'submissions' | 'withdrawals' | 'payoutSettings' | 'planSubmissions' | 'funding' | 'supportSettings' | 'content' | 'plans' | 'activity' | 'advertisement' | 'controls' | 'campaigns' | 'announcement' | 'branding';
type AccountStatus = 'active' | 'suspended' | 'banned';
type VerificationMode = 'manual' | 'automatic';
type AdminProfile = Pick<Profile, 'user_id' | 'full_name' | 'username' | 'phone' | 'tier' | 'joined_at'> & {
  account_status: AccountStatus;
  status_reason: string | null;
};
type AdminBalance = { user_id: string; reward_balance: number; referral_balance: number; fund_balance: number; total_earned: number };
type AdminCompletion = TaskCompletion & { task?: Pick<Task, 'title' | 'reward'> };
type FraudFlag = { user_id: string; flag: string; matched_accounts: number };
type AdminUserDetails = {
  username: string;
  email: string;
  joined_at: string;
  account_status: string;
  login_history: { ip_address: string | null; user_agent: string; created_at: string }[];
  referred_users: { user_id: string; username: string; joined_at: string }[];
  ip_matches: { user_id: string; username: string; ip_address: string }[];
};
type TaskDraft = {
  title: string;
  description: string;
  category: string;
  reward: string;
  difficulty: string;
  task_url: string;
  daily_quota: string;
  proof_required: boolean;
  proof_instructions: string;
  is_funded: boolean;
  required_plan_code: string;
  verification_mode: VerificationMode;
};

const emptyTask: TaskDraft = {
  title: '',
  description: '',
  category: 'Social Media',
  reward: '',
  difficulty: 'Easy',
  task_url: '',
  daily_quota: '0',
  proof_required: false,
  proof_instructions: '',
  is_funded: false,
  required_plan_code: 'free',
  verification_mode: 'manual',
};

const sections: { id: Section; label: string; icon: typeof ClipboardList }[] = [
  { id: 'tasks', label: 'Hustles', icon: ClipboardList },
  { id: 'users', label: 'Users & wallets', icon: Users },
  { id: 'submissions', label: 'Hustle review', icon: BadgeCheck },
  { id: 'withdrawals', label: 'Withdrawals', icon: CreditCard },
  { id: 'payoutSettings', label: 'Payout schedule', icon: CalendarClock },
  { id: 'planSubmissions', label: 'Plan approvals', icon: BadgeCheck },
  { id: 'funding', label: 'Wallet funding', icon: CircleDollarSign },
  { id: 'supportSettings', label: 'Live chat settings', icon: MessageCircle },
  { id: 'content', label: 'CMS & media', icon: FileText },
  { id: 'plans', label: 'Plans', icon: Package },
  { id: 'activity', label: 'Audit & logins', icon: History },
  { id: 'advertisement', label: 'Dashboard ad', icon: Image },
  { id: 'controls', label: 'Platform controls', icon: SlidersHorizontal },
  { id: 'campaigns', label: 'Campaign approvals', icon: Megaphone },
  { id: 'announcement', label: 'Welcome popup', icon: FileText },
  { id: 'branding', label: 'Brand images', icon: Image },
];

interface Props {
  user: User;
}

export default function AdminPanel({ user }: Props) {
  const [section, setSection] = useState<Section>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [balances, setBalances] = useState<AdminBalance[]>([]);
  const [completions, setCompletions] = useState<AdminCompletion[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);
  const [selectedCompletionIds, setSelectedCompletionIds] = useState<string[]>([]);
  const [bulkReviewNote, setBulkReviewNote] = useState('');
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [taskCategoryFilter, setTaskCategoryFilter] = useState('All');
  const [bulkVerificationMode, setBulkVerificationMode] = useState<VerificationMode>('manual');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState('');
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(emptyTask);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [walletUser, setWalletUser] = useState<AdminProfile | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ profile: AdminProfile; status: AccountStatus } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [walletForm, setWalletForm] = useState({ balanceType: 'reward', direction: 'credit', amount: '', reason: '' });
  const [references, setReferences] = useState<Record<string, string>>({});
  const [selectedUser, setSelectedUser] = useState<AdminProfile | null>(null);
  const [userDetails, setUserDetails] = useState<AdminUserDetails | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [resetLink, setResetLink] = useState('');

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      setMessage('');
      const start = page * 50;
      const [taskResult, profileResult, completionResult, withdrawalResult] = await Promise.all([
        supabase.from('tasks').select('*').order('sort_order').order('created_at', { ascending: false }),
        supabase.from('profiles')
          .select('user_id, full_name, username, phone, tier, joined_at, account_status, status_reason', { count: 'exact' })
          .order('joined_at', { ascending: false })
          .range(start, start + 49),
        supabase.from('task_completions').select('*').order('completed_at', { ascending: false }).limit(100),
        supabase.from('withdrawals').select('*').order('requested_at', { ascending: false }).limit(100),
      ]);

      const error = taskResult.error ?? profileResult.error ?? completionResult.error ?? withdrawalResult.error;
      if (error) {
        if (active) setMessage(error.message);
        if (active) setLoading(false);
        return;
      }

      const currentProfiles = (profileResult.data ?? []) as AdminProfile[];
      const userIds = currentProfiles.map(profile => profile.user_id);
      const balanceResult = userIds.length
        ? await supabase.from('balances').select('user_id, reward_balance, referral_balance, fund_balance, total_earned').in('user_id', userIds)
        : { data: [], error: null };
      if (balanceResult.error) {
        if (active) setMessage(balanceResult.error.message);
        if (active) setLoading(false);
        return;
      }

      const currentCompletions = (completionResult.data ?? []) as TaskCompletion[];
      const taskIds = [...new Set(currentCompletions.map(completion => completion.task_id))];
      const reviewTasks = taskIds.length
        ? await supabase.from('tasks').select('id, title, reward').in('id', taskIds)
        : { data: [], error: null };
      if (reviewTasks.error) {
        if (active) setMessage(reviewTasks.error.message);
        if (active) setLoading(false);
        return;
      }

      if (active) {
        const taskDetails = new Map((reviewTasks.data ?? []).map(task => [task.id, task]));
        setTasks((taskResult.data ?? []) as Task[]);
        setProfiles(currentProfiles);
        setBalances((balanceResult.data ?? []) as AdminBalance[]);
        setCompletions(currentCompletions.map(completion => ({ ...completion, task: taskDetails.get(completion.task_id) })));
        setWithdrawals((withdrawalResult.data ?? []) as Withdrawal[]);
        setTotalUsers(profileResult.count ?? 0);
        setLoading(false);
      }
    }

    loadData();
    return () => { active = false; };
  }, [page, refreshKey, user.id]);

  useEffect(() => {
    let active = true;
    supabase.rpc('admin_fraud_flags').then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      else setFraudFlags((data ?? []) as FraudFlag[]);
    });
    return () => { active = false; };
  }, [refreshKey]);

  async function openUserDetail(profile: AdminProfile) {
    setSelectedUser(profile);
    setUserDetails(null);
    setResetLink('');
    setUserDetailLoading(true);
    const { data, error } = await supabase.rpc('admin_user_details', { p_user_id: profile.user_id });
    setUserDetailLoading(false);
    if (error) return notify(error.message);
    setUserDetails(data as AdminUserDetails);
  }

  async function createPasswordResetLink() {
    if (!selectedUser) return;
    const { data, error } = await supabase.functions.invoke('admin-reset-password', { body: { user_id: selectedUser.user_id } });
    if (error) return notify(error.message);
    setResetLink((data as { action_link?: string }).action_link ?? '');
    notify('Recovery link generated. Share it with the account owner through a verified channel.');
  }

  function notify(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 4500);
  }

  function editTask(task: Task) {
    setEditingTask(task.id);
    setTaskDraft({
      title: task.title,
      description: task.description,
      category: task.category,
      reward: String(task.reward),
      difficulty: task.difficulty,
      task_url: task.task_url,
      daily_quota: String(task.daily_quota),
      proof_required: task.proof_required,
      proof_instructions: task.proof_instructions,
      is_funded: task.is_funded,
      required_plan_code: task.required_plan_code,
      verification_mode: task.verification_mode,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const values = {
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      category: taskDraft.category.trim(),
      reward: Number(taskDraft.reward),
      difficulty: taskDraft.difficulty,
      task_url: taskDraft.task_url.trim(),
      daily_quota: Number(taskDraft.daily_quota),
      proof_required: taskDraft.proof_required,
      proof_instructions: taskDraft.proof_instructions.trim(),
      is_funded: taskDraft.is_funded,
      required_plan_code: taskDraft.required_plan_code,
      verification_mode: taskDraft.verification_mode,
    };
    const result = editingTask
      ? await supabase.from('tasks').update(values).eq('id', editingTask)
      : await supabase.from('tasks').insert(values);
    setSaving(false);
    if (result.error) return notify(result.error.message);
    setTaskDraft(emptyTask);
    setEditingTask(null);
    setRefreshKey(current => current + 1);
    notify(editingTask ? 'Hustle updated.' : 'Hustle created.');
  }

  async function toggleTask(task: Task) {
    const { error } = await supabase.from('tasks').update({ is_active: !task.is_active }).eq('id', task.id);
    if (error) return notify(error.message);
    setRefreshKey(current => current + 1);
    notify(task.is_active ? 'Hustle paused.' : 'Hustle activated.');
  }

  async function shuffleTasks() {
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_shuffle_tasks', {
      p_category: taskCategoryFilter === 'All' ? null : taskCategoryFilter,
    });
    setSaving(false);
    if (error) return notify(error.message);
    setRefreshKey(current => current + 1);
    notify(`Randomized the order of ${Number(data ?? 0)} campaigns.`);
  }

  async function setCategoryVerificationMode() {
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_set_task_verification_mode', {
      p_category: taskCategoryFilter === 'All' ? null : taskCategoryFilter,
      p_mode: bulkVerificationMode,
    });
    setSaving(false);
    if (error) return notify(error.message);
    setRefreshKey(current => current + 1);
    notify(`Updated verification mode for ${Number(data ?? 0)} hustles.`);
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete "${task.title}"? Existing submissions will also be removed.`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) return notify(error.message);
    setRefreshKey(current => current + 1);
    notify('Hustle deleted.');
  }

  async function adjustWallet(event: React.FormEvent) {
    event.preventDefault();
    if (!walletUser) return;
    setSaving(true);
    const amount = Number(walletForm.amount) * (walletForm.direction === 'debit' ? -1 : 1);
    const { error } = await supabase.rpc('admin_adjust_wallet', {
      p_user_id: walletUser.user_id,
      p_balance_type: walletForm.balanceType,
      p_amount: amount,
      p_reason: walletForm.reason.trim(),
    });
    setSaving(false);
    if (error) return notify(error.message);
    setWalletUser(null);
    setWalletForm({ balanceType: 'reward', direction: 'credit', amount: '', reason: '' });
    setRefreshKey(current => current + 1);
    notify('Wallet adjustment recorded in the ledger.');
  }

  async function saveUserStatus(event: React.FormEvent) {
    event.preventDefault();
    if (!statusTarget) return;
    setSaving(true);
    const { error } = await supabase.rpc('admin_set_user_status', {
      p_user_id: statusTarget.profile.user_id,
      p_status: statusTarget.status,
      p_reason: statusReason.trim(),
    });
    setSaving(false);
    if (error) return notify(error.message);
    setStatusTarget(null);
    setStatusReason('');
    setRefreshKey(current => current + 1);
    notify(`User account ${statusTarget.status}.`);
  }

  async function reviewCompletion(completion: AdminCompletion, status: 'approved' | 'rejected') {
    if (status === 'rejected' && !window.confirm('Reject this hustle submission?')) return;
    const { error } = await supabase.rpc('admin_review_task_completion', {
      p_completion_id: completion.id,
      p_status: status,
      p_review_note: null,
    });
    if (error) return notify(error.message);
    setRefreshKey(current => current + 1);
    notify(status === 'approved' ? 'Hustle approved and reward credited.' : 'Hustle submission rejected.');
  }

  async function bulkReviewCompletions(status: 'approved' | 'rejected') {
    if (selectedCompletionIds.length === 0) return notify('Select at least one pending hustle.');
    if (status === 'rejected' && !bulkReviewNote.trim()) return notify('Add an instruction message before bulk rejection.');
    setSaving(true);
    const results = await Promise.all(selectedCompletionIds.map(completionId => supabase.rpc('admin_review_task_completion', {
      p_completion_id: completionId,
      p_status: status,
      p_review_note: bulkReviewNote.trim() || null,
    })));
    setSaving(false);
    const error = results.find(result => result.error)?.error;
    if (error) return notify(error.message);
    setSelectedCompletionIds([]);
    setBulkReviewNote('');
    setRefreshKey(current => current + 1);
    notify(`${selectedCompletionIds.length} submissions ${status}.`);
  }

  async function moveTask(task: Task, direction: -1 | 1) {
    const index = tasks.findIndex(item => item.id === task.id);
    const other = tasks[index + direction];
    if (!other) return;
    const reordered = [...tasks];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    setSaving(true);
    const { error } = await supabase.rpc('admin_reorder_tasks', { p_task_ids: reordered.map(item => item.id) });
    setSaving(false);
    if (error) return notify(error.message);
    setRefreshKey(current => current + 1);
    notify('Hustle display order updated.');
  }

  async function openTaskProof(path: string) {
    const { data, error } = await supabase.storage.from('task-proofs').createSignedUrl(path, 120);
    if (error) return notify(error.message);
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function reviewWithdrawal(withdrawal: Withdrawal, status: 'paid' | 'rejected') {
    const reference = references[withdrawal.id] ?? '';
    if (status === 'paid' && !reference.trim()) return notify('Enter a transaction reference before marking paid.');
    if (status === 'rejected' && !window.confirm('Reject this withdrawal request?')) return;
    const { error } = await supabase.rpc('admin_review_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_status: status,
      p_transaction_reference: reference.trim() || null,
    });
    if (error) return notify(error.message);
    setRefreshKey(current => current + 1);
    notify(status === 'paid' ? 'Payout recorded and wallet debited.' : 'Withdrawal rejected.');
  }

  const userBalances = new Map(balances.map(balance => [balance.user_id, balance]));
  const userProfiles = new Map(profiles.map(profile => [profile.user_id, profile]));
  const userRiskFlags = new Map<string, FraudFlag[]>();
  for (const flag of fraudFlags) userRiskFlags.set(flag.user_id, [...(userRiskFlags.get(flag.user_id) ?? []), flag]);
  const visibleProfiles = profiles.filter(profile => {
    const query = search.trim().toLowerCase();
    return !query || `${profile.full_name} ${profile.username} ${profile.phone ?? ''}`.toLowerCase().includes(query);
  });
  const pendingCompletions = completions.filter(completion => completion.status === 'pending');
  const pendingWithdrawals = withdrawals.filter(withdrawal => withdrawal.status === 'pending');
  const taskCategories = ['All', ...new Set(tasks.map(task => task.category))];
  const visibleTasks = tasks.filter(task => taskCategoryFilter === 'All' || task.category === taskCategoryFilter);

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#080808]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
              <ShieldCheck size={20} />
            </div>
            <div>
              <p className="font-bold">Mr Hustle</p>
              <p className="text-xs text-gray-500">Administration · {user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => supabase.auth.signOut()}
              className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-red-400/30 hover:text-red-300"
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
        <AdminMetricsPanel />
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-emerald-300">Operations</p>
            <h1 className="text-2xl font-black">Admin console</h1>
          </div>
          <div className="flex gap-3 text-xs text-gray-400">
            <span>{totalUsers.toLocaleString()} users</span>
            <span>{pendingCompletions.length} hustle reviews</span>
            <span>{pendingWithdrawals.length} payouts pending</span>
          </div>
        </div>

        <nav className="mb-6 flex gap-2 overflow-x-auto border-b border-white/8 pb-3" aria-label="Admin sections">
          {sections.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  section === item.id ? 'bg-emerald-300 text-black' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={16} /> {item.label}
              </button>
            );
          })}
        </nav>

        {message && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200" role="status">
            {message}
            <button onClick={() => setMessage('')} aria-label="Dismiss message"><X size={15} /></button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-56 items-center justify-center text-gray-400">
            <Loader2 className="mr-2 animate-spin" size={18} /> Loading admin data
          </div>
        ) : (
          <>
            {section === 'tasks' && (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="order-2 space-y-3 xl:order-2" aria-label="Hustle catalog">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
                    <p className="text-xs text-gray-400">{visibleTasks.length} of {tasks.length} visible campaigns · unfunded hustles cannot be claimed</p>
                    <div className="flex items-center gap-2">
                      <select value={taskCategoryFilter} onChange={event => setTaskCategoryFilter(event.target.value)} aria-label="Filter hustles by category" className="admin-input max-w-64">
                        {taskCategories.map(category => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <select value={bulkVerificationMode} onChange={event => setBulkVerificationMode(event.target.value as VerificationMode)} aria-label="Bulk verification mode" className="admin-input max-w-48">
                        <option value="manual">Manual review</option>
                        <option value="automatic">Automatic</option>
                      </select>
                      <button onClick={setCategoryVerificationMode} disabled={saving} className="rounded border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40">Apply mode</button>
                      <button onClick={shuffleTasks} disabled={saving || visibleTasks.length < 2} className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40"><Shuffle size={14} /> Shuffle</button>
                    </div>
                  </div>
                  {visibleTasks.map((task, index) => (
                    <article key={task.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center bg-white/5 text-[10px] font-bold text-gray-400">{index + 1}</span><h2 className="font-semibold">{task.title}</h2>
                          <span className={`rounded px-2 py-0.5 text-[11px] ${task.is_active ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/8 text-gray-400'}`}>
                            {task.is_active ? 'Active' : 'Paused'}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-[11px] ${task.is_funded ? 'bg-green-400/10 text-green-300' : 'bg-amber-400/10 text-amber-300'}`}>
                            {task.is_funded ? 'Funded' : 'Draft funding'}
                          </span>
                          <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-gray-400">
                            {task.verification_mode === 'automatic' ? 'Auto verify' : 'Manual review'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{task.category} · ₦{task.reward.toLocaleString()} · {task.required_plan_code} plan · quota {task.daily_quota || 'unlimited'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => void moveTask(task, -1)} disabled={saving || index === 0} aria-label={`Move hustle ${index + 1} up`} className="rounded border border-white/10 p-2 text-gray-400 hover:text-white disabled:opacity-30"><ChevronUp size={14} /></button>
                        <button onClick={() => void moveTask(task, 1)} disabled={saving || index === visibleTasks.length - 1} aria-label={`Move hustle ${index + 1} down`} className="rounded border border-white/10 p-2 text-gray-400 hover:text-white disabled:opacity-30"><ChevronDown size={14} /></button>
                        <button onClick={() => toggleTask(task)} className="rounded border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">
                          {task.is_active ? 'Pause' : 'Activate'}
                        </button>
                        <button onClick={() => editTask(task)} className="rounded border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">Edit</button>
                        <button onClick={() => deleteTask(task)} aria-label={`Delete ${task.title}`} className="rounded p-2 text-gray-500 hover:bg-red-400/10 hover:text-red-300">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                  {visibleTasks.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No campaigns in this category.</p>}
                </section>

                <form onSubmit={saveTask} className="order-1 h-fit space-y-4 border-l border-white/8 pl-0 xl:order-1 xl:pl-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold">{editingTask ? 'Edit hustle' : 'Create hustle'}</h2>
                    {editingTask && <button type="button" onClick={() => { setEditingTask(null); setTaskDraft(emptyTask); }} aria-label="Cancel editing" className="text-gray-400 hover:text-white"><X size={16} /></button>}
                  </div>
                  <input required value={taskDraft.title} onChange={event => setTaskDraft({ ...taskDraft, title: event.target.value })} placeholder="Hustle title" className="admin-input" />
                  <textarea required rows={3} value={taskDraft.description} onChange={event => setTaskDraft({ ...taskDraft, description: event.target.value })} placeholder="Description" className="admin-input resize-y" />
                  <div className="grid grid-cols-2 gap-3">
                    <input required value={taskDraft.category} onChange={event => setTaskDraft({ ...taskDraft, category: event.target.value })} placeholder="Category" className="admin-input" />
                    <select value={taskDraft.required_plan_code} onChange={event => setTaskDraft({ ...taskDraft, required_plan_code: event.target.value })} className="admin-input">
                      {['free', 'premium', 'vip', 'president'].map(value => <option key={value} value={value}>{value === 'free' ? 'H. Free' : value === 'premium' ? 'H. Maniac' : value === 'vip' ? 'H. Supreme Max' : 'H. President Max'}</option>)}
                    </select>
                  </div>
                  <label className="block text-xs text-gray-400">Verification mode
                    <select value={taskDraft.verification_mode} onChange={event => setTaskDraft({ ...taskDraft, verification_mode: event.target.value as VerificationMode })} className="admin-input mt-1">
                      <option value="manual">Manual admin review</option>
                      <option value="automatic">Signed partner callback</option>
                    </select>
                  </label>
                  {taskDraft.verification_mode === 'automatic' && <p className="text-xs leading-relaxed text-amber-300">Automatic credit requires the deployed `complete-task-verification` function, a server-only TASK_VERIFICATION_SECRET, and a partner that calls back after verified completion.</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-gray-400">Reward (₦)<input required type="number" min="0.01" step="0.01" value={taskDraft.reward} onChange={event => setTaskDraft({ ...taskDraft, reward: event.target.value })} className="admin-input mt-1" /></label>
                    <label className="text-xs text-gray-400">Daily quota (0 = none)<input required type="number" min="0" step="1" value={taskDraft.daily_quota} onChange={event => setTaskDraft({ ...taskDraft, daily_quota: event.target.value })} className="admin-input mt-1" /></label>
                  </div>
                  <input type="url" required={taskDraft.verification_mode === 'automatic'} value={taskDraft.task_url} onChange={event => setTaskDraft({ ...taskDraft, task_url: event.target.value })} placeholder="Hustle URL" className="admin-input" />
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input type="checkbox" checked={taskDraft.is_funded} onChange={event => setTaskDraft({ ...taskDraft, is_funded: event.target.checked })} className="accent-emerald-400" /> Campaign budget is funded and approved
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input type="checkbox" checked={taskDraft.proof_required} onChange={event => setTaskDraft({ ...taskDraft, proof_required: event.target.checked })} className="accent-emerald-400" /> Require submission proof
                  </label>
                  {taskDraft.proof_required && <textarea required rows={2} value={taskDraft.proof_instructions} onChange={event => setTaskDraft({ ...taskDraft, proof_instructions: event.target.value })} placeholder="Proof instructions" className="admin-input resize-y" />}
                  <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : editingTask ? <Check size={16} /> : <Plus size={16} />}
                    {editingTask ? 'Save changes' : 'Create hustle'}
                  </button>
                </form>
              </div>
            )}

            {section === 'users' && (
              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-gray-400">Showing {visibleProfiles.length} of {totalUsers.toLocaleString()} users · 50 per page</p>
                  <label className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-gray-400">
                    <Search size={16} />
                    <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter this page" className="w-full bg-transparent text-sm text-white outline-none" />
                  </label>
                </div>
                <div className="overflow-x-auto border-y border-white/8">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="text-xs uppercase text-gray-500"><tr><th className="py-3 pr-4">Hustler</th><th className="py-3 pr-4">Tier</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Hustler Wallet</th><th className="py-3 pr-4">Referral Wallet</th><th className="py-3 pr-4">Fund Wallet</th><th className="py-3 pr-4">Joined</th><th className="py-3">Wallet action</th></tr></thead>
                    <tbody className="divide-y divide-white/6">
                      {visibleProfiles.map(profile => {
                        const balance = userBalances.get(profile.user_id);
                        return (
                          <tr key={profile.user_id}>
                            <td className="py-3 pr-4"><button onClick={() => void openUserDetail(profile)} className="text-left font-semibold hover:text-amber-200">{profile.full_name || profile.username}</button><p className="text-xs text-gray-500">@{profile.username} · {profile.phone || 'No phone'}</p>{(userRiskFlags.get(profile.user_id) ?? []).map(flag => <span key={flag.flag} className="mt-1 mr-1 inline-block border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] text-red-200">Risk: {flag.flag} ({flag.matched_accounts})</span>)}</td>
                            <td className="py-3 pr-4 text-gray-300">{profile.tier}</td>
                            <td className="py-3 pr-4">
                              <select
                                value={profile.account_status}
                                disabled={profile.user_id === user.id}
                                onChange={event => {
                                  const nextStatus = event.target.value as AccountStatus;
                                  setStatusReason('');
                                  setStatusTarget({ profile, status: nextStatus });
                                }}
                                aria-label={`Account status for ${profile.full_name || profile.username}`}
                                className="admin-input max-w-36 py-1.5 text-xs disabled:opacity-50"
                              >
                                <option value="active">Active</option>
                                <option value="suspended">Suspended</option>
                                <option value="banned">Banned</option>
                              </select>
                            </td>
                            <td className="py-3 pr-4">₦{(balance?.reward_balance ?? 0).toLocaleString()}</td>
                            <td className="py-3 pr-4">₦{(balance?.referral_balance ?? 0).toLocaleString()}</td>
                            <td className="py-3 pr-4">₦{(balance?.fund_balance ?? 0).toLocaleString()}</td>
                            <td className="py-3 pr-4 text-gray-400">{profile.joined_at ? new Date(profile.joined_at).toLocaleDateString('en-NG') : '—'}</td>
                            <td className="py-3"><button onClick={() => setWalletUser(profile)} className="inline-flex items-center gap-1.5 rounded border border-emerald-300/20 px-2.5 py-1.5 text-xs text-emerald-200 hover:bg-emerald-300/10"><CircleDollarSign size={14} /> Adjust</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {visibleProfiles.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No users match this page filter.</p>}
                </div>
                <div className="mt-4 flex items-center justify-end gap-3">
                  <button disabled={page === 0} onClick={() => setPage(current => current - 1)} className="rounded border border-white/10 p-2 text-gray-300 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={16} /></button>
                  <span className="text-xs text-gray-500">Page {page + 1} of {Math.max(1, Math.ceil(totalUsers / 50))}</span>
                  <button disabled={(page + 1) * 50 >= totalUsers} onClick={() => setPage(current => current + 1)} className="rounded border border-white/10 p-2 text-gray-300 disabled:opacity-30" aria-label="Next page"><ChevronRight size={16} /></button>
                </div>
              </section>
            )}

            {section === 'submissions' && (
              <section className="space-y-3">
                <div className="sticky top-20 z-10 grid gap-3 border border-white/10 bg-[#111] p-4 shadow-xl sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-end">
                  <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={pendingCompletions.length > 0 && pendingCompletions.every(completion => selectedCompletionIds.includes(completion.id))} onChange={event => setSelectedCompletionIds(event.target.checked ? pendingCompletions.map(completion => completion.id) : [])} className="accent-orange-400" />Select all ({pendingCompletions.length})</label>
                  <label className="text-xs text-gray-400">Instruction message<textarea value={bulkReviewNote} onChange={event => setBulkReviewNote(event.target.value)} maxLength={500} rows={2} placeholder="Optional approval note or rejection instructions" className="admin-input mt-1 resize-y" /></label>
                  <button type="button" onClick={() => void bulkReviewCompletions('approved')} disabled={saving || selectedCompletionIds.length === 0} className="bg-orange-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-40">Bulk approve</button>
                  <button type="button" onClick={() => void bulkReviewCompletions('rejected')} disabled={saving || selectedCompletionIds.length === 0 || !bulkReviewNote.trim()} className="border border-white/20 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Bulk reject</button>
                </div>
                {pendingCompletions.map(completion => {
                  const profile = userProfiles.get(completion.user_id);
                  return (
                    <article key={completion.id} className="border-b border-white/8 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <label className="mb-2 inline-flex items-center gap-2 text-[11px] text-gray-500"><input type="checkbox" checked={selectedCompletionIds.includes(completion.id)} onChange={event => setSelectedCompletionIds(current => event.target.checked ? [...new Set([...current, completion.id])] : current.filter(id => id !== completion.id))} className="accent-orange-400" />Select hustle</label>
                          <h2 className="font-semibold">{completion.task?.title ?? 'Hustle submission'}</h2>
                          <p className="mt-1 text-xs text-gray-400">{profile?.full_name ?? profile?.username ?? completion.user_id} · {new Date(completion.completed_at).toLocaleString('en-NG')}</p>
                          {completion.proof_text && <p className="mt-3 whitespace-pre-wrap rounded bg-white/5 p-3 text-sm text-gray-300">{completion.proof_text}</p>}
                          {completion.proof_path && <button onClick={() => openTaskProof(completion.proof_path!)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200"><ExternalLink size={13} /> View private screenshot</button>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="mr-2 text-sm font-semibold text-emerald-300">₦{(completion.task?.reward ?? 0).toLocaleString()}</span>
                          <button onClick={() => reviewCompletion(completion, 'approved')} className="rounded bg-emerald-300 px-3 py-2 text-xs font-bold text-black">Approve</button>
                          <button onClick={() => reviewCompletion(completion, 'rejected')} className="rounded border border-red-300/20 px-3 py-2 text-xs text-red-300">Reject</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {pendingCompletions.length === 0 && <p className="py-12 text-center text-sm text-gray-500">No pending hustle submissions.</p>}
              </section>
            )}

            {section === 'withdrawals' && (
              <section className="space-y-3">
                {withdrawals.map(withdrawal => {
                  const profile = userProfiles.get(withdrawal.user_id);
                  return (
                    <article key={withdrawal.id} className="border-b border-white/8 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">₦{withdrawal.amount.toLocaleString()} · {withdrawal.bank_name}</h2><span className={`rounded px-2 py-0.5 text-[11px] ${withdrawal.status === 'pending' ? 'bg-amber-300/10 text-amber-200' : 'bg-white/8 text-gray-400'}`}>{withdrawal.status}</span></div>
                          <p className="mt-1 text-xs text-gray-400">{profile?.full_name ?? profile?.username ?? withdrawal.user_id} · {withdrawal.wallet_type ?? 'hustler'} wallet · {withdrawal.account_name} · {withdrawal.account_no}</p>
                          {(userRiskFlags.get(withdrawal.user_id) ?? []).map(flag => <p key={flag.flag} className="mt-2 inline-block border border-red-400/30 bg-red-400/10 px-2 py-1 text-[11px] font-semibold text-red-200">Risk flag: {flag.flag} ({flag.matched_accounts} accounts)</p>)}
                          <p className="mt-1 text-xs text-gray-500">Requested {new Date(withdrawal.requested_at).toLocaleString('en-NG')}</p>
                        </div>
                        {withdrawal.status === 'pending' && (
                          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                            <input value={references[withdrawal.id] ?? ''} onChange={event => setReferences(current => ({ ...current, [withdrawal.id]: event.target.value }))} placeholder="Transaction reference" className="admin-input min-w-48 flex-1 sm:flex-none" />
                            <button onClick={() => reviewWithdrawal(withdrawal, 'paid')} className="rounded bg-emerald-300 px-3 py-2 text-xs font-bold text-black">Mark paid</button>
                            <button onClick={() => reviewWithdrawal(withdrawal, 'rejected')} className="rounded border border-red-300/20 px-3 py-2 text-xs text-red-300">Reject</button>
                          </div>
                        )}
                        {withdrawal.transaction_reference && <p className="w-full text-xs text-gray-500">Reference: {withdrawal.transaction_reference}</p>}
                      </div>
                    </article>
                  );
                })}
                {withdrawals.length === 0 && <p className="py-12 text-center text-sm text-gray-500">No withdrawal requests.</p>}
              </section>
            )}

            {section === 'content' && <AdminContentPanel />}
            {section === 'plans' && <AdminPlansPanel />}
            {section === 'activity' && <AdminActivityPanel />}
            {section === 'payoutSettings' && <AdminPayoutSettingsPanel />}
            {section === 'planSubmissions' && <AdminSubscriptionReviewPanel />}
            {section === 'funding' && <AdminFundingPanel />}
            {section === 'supportSettings' && <AdminSupportSettingsPanel />}
            {section === 'advertisement' && <AdminAdBannerPanel />}
            {section === 'controls' && <AdminPlatformSettingsPanel />}
            {section === 'campaigns' && <AdminCampaignPanel />}
            {section === 'announcement' && <AdminAnnouncementPanel />}
            {section === 'branding' && <AdminBrandingPanel />}
          </>
        )}
      </main>

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedUser(null); }}>
          <section role="dialog" aria-modal="true" aria-label="User activity details" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-white/10 bg-[#111] p-5 shadow-2xl sm:p-6">
            <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div><p className="text-xs font-bold uppercase text-amber-300">Account activity</p><h2 className="mt-1 text-lg font-bold">{selectedUser.full_name || selectedUser.username}</h2><p className="text-xs text-gray-500">@{selectedUser.username} · Registered {selectedUser.joined_at ? new Date(selectedUser.joined_at).toLocaleString('en-NG') : 'unknown'}</p></div>
              <button onClick={() => setSelectedUser(null)} aria-label="Close user details" className="p-2 text-gray-400 hover:text-white"><X size={18} /></button>
            </header>
            {userDetailLoading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={16} />Loading account activity</p> : userDetails && <div className="space-y-5 py-5">
              <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-gray-500">Email</dt><dd className="break-all">{userDetails.email || 'Unavailable'}</dd></div><div><dt className="text-xs text-gray-500">Phone</dt><dd>{selectedUser.phone || 'Unavailable'}</dd></div><div><dt className="text-xs text-gray-500">Username</dt><dd>@{userDetails.username}</dd></div><div><dt className="text-xs text-gray-500">Status</dt><dd className="capitalize">{userDetails.account_status}</dd></div></dl>
              <section><h3 className="mb-2 text-sm font-bold">Login devices and IP addresses</h3><div className="divide-y divide-white/8 border-y border-white/8">{userDetails.login_history.map((login, index) => <div key={`${login.created_at}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[1fr_1.5fr_auto]"><span className="text-xs text-amber-200">{login.ip_address || 'IP unavailable'}</span><span className="break-all text-xs text-gray-400">{login.user_agent || 'Device unavailable'}</span><time className="text-xs text-gray-500">{new Date(login.created_at).toLocaleString('en-NG')}</time></div>)}{userDetails.login_history.length === 0 && <p className="py-4 text-xs text-gray-500">No login history recorded.</p>}</div></section>
              <section><h3 className="mb-2 text-sm font-bold">Shared-IP account comparisons</h3><div className="flex flex-wrap gap-2">{userDetails.ip_matches.slice(0, 20).map((match, index) => <span key={`${match.user_id}-${index}`} className="border border-red-400/20 bg-red-400/5 px-2 py-1 text-xs text-red-200">@{match.username} · {match.ip_address}</span>)}{userDetails.ip_matches.length === 0 && <p className="text-xs text-gray-500">No shared IP matches detected.</p>}</div></section>
              <section><h3 className="mb-2 text-sm font-bold">Registered referrals</h3><div className="flex flex-wrap gap-2">{userDetails.referred_users.map(referred => <span key={referred.user_id} className="border border-white/10 px-2 py-1 text-xs text-gray-300">@{referred.username} · {new Date(referred.joined_at).toLocaleDateString('en-NG')}</span>)}{userDetails.referred_users.length === 0 && <p className="text-xs text-gray-500">No referred accounts recorded.</p>}</div></section>
              <section className="border-t border-white/10 pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold">Password recovery</h3><p className="mt-1 text-xs text-gray-500">Generate a recovery link for the account owner. Never request their current password.</p></div><button onClick={() => void createPasswordResetLink()} className="border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-300/10">Generate reset link</button></div>{resetLink && <textarea readOnly value={resetLink} rows={3} className="admin-input mt-3 resize-y" aria-label="Generated password recovery link" />}</section>
            </div>}
          </section>
        </div>
      )}

      {walletUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setWalletUser(null); }}>
          <form onSubmit={adjustWallet} className="w-full max-w-md space-y-4 border border-white/10 bg-[#111] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase text-emerald-300">Audited adjustment</p><h2 className="mt-1 font-bold">{walletUser.full_name || walletUser.username}</h2></div>
              <button type="button" onClick={() => setWalletUser(null)} aria-label="Close adjustment form" className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <label className="block text-xs text-gray-400">Balance<select value={walletForm.balanceType} onChange={event => setWalletForm({ ...walletForm, balanceType: event.target.value })} className="admin-input mt-1"><option value="reward">Hustler Wallet</option><option value="referral">Referral Wallet</option><option value="fund">Fund Wallet</option></select></label>
            <label className="block text-xs text-gray-400">Adjustment type<select value={walletForm.direction} onChange={event => setWalletForm({ ...walletForm, direction: event.target.value })} className="admin-input mt-1"><option value="credit">Credit</option><option value="debit">Debit</option></select></label>
            <label className="block text-xs text-gray-400">Amount (₦)<input required type="number" min="0.01" step="0.01" value={walletForm.amount} onChange={event => setWalletForm({ ...walletForm, amount: event.target.value })} className="admin-input mt-1" /></label>
            <label className="block text-xs text-gray-400">Audit reason<textarea required maxLength={500} rows={3} value={walletForm.reason} onChange={event => setWalletForm({ ...walletForm, reason: event.target.value })} className="admin-input mt-1 resize-y" /></label>
            <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CircleDollarSign size={16} />} Record adjustment
            </button>
          </form>
        </div>
      )}

      {statusTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setStatusTarget(null); }}>
          <form onSubmit={saveUserStatus} className="w-full max-w-md space-y-4 border border-white/10 bg-[#111] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase text-amber-300">Account control</p><h2 className="mt-1 font-bold">{statusTarget.profile.full_name || statusTarget.profile.username}</h2></div>
              <button type="button" onClick={() => setStatusTarget(null)} aria-label="Close status form" className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-400">Set this account to <span className="font-semibold capitalize text-white">{statusTarget.status}</span>. The reason will be stored in the admin audit log.</p>
            <label className="block text-xs text-gray-400">Reason<textarea required maxLength={500} rows={3} value={statusReason} onChange={event => setStatusReason(event.target.value)} className="admin-input mt-1 resize-y" /></label>
            <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save account status</button>
          </form>
        </div>
      )}

      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(110,231,183,.55)}.admin-input::placeholder{color:#6b7280}`}</style>
    </div>
  );
}