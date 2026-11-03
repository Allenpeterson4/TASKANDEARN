import { useMemo, useState } from 'react';
import { Bell, CheckCircle, Clock, CreditCard, WalletCards, X } from 'lucide-react';
import type { TaskCompletion, Withdrawal } from '@/lib/supabase';

type FundingDeposit = { id: string; amount: number; status: string; created_at: string };
type NotificationItem = { id: string; type: 'system' | 'task' | 'funding' | 'withdrawal'; title: string; body: string; date: string };

interface Props {
  completions: TaskCompletion[];
  withdrawals: Withdrawal[];
  deposits: FundingDeposit[];
  onClose: () => void;
}

export default function NotificationsPanel({ completions, withdrawals, deposits, onClose }: Props) {
  const [readIds, setReadIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mrhustler-read-notifications') ?? '[]') as string[]; } catch { return []; }
  });
  const notifications = useMemo<NotificationItem[]>(() => [
    { id: 'system-account', type: 'system' as const, title: 'System update', body: 'Your account notifications are now active.', date: new Date().toISOString() },
    ...completions.map(completion => ({
      id: `task-${completion.id}`,
      type: 'task' as const,
      title: completion.status === 'approved' ? 'Task approved' : completion.status === 'rejected' ? 'Task submission declined' : 'Task submitted for review',
      body: completion.status === 'approved' ? 'Your reward has been credited to your wallet.' : completion.status === 'rejected' ? 'Review the task requirements and try again.' : 'Your task is awaiting verification.',
      date: completion.reviewed_at ?? completion.completed_at,
    })),
    ...deposits.map(deposit => ({
      id: `funding-${deposit.id}`,
      type: 'funding' as const,
      title: deposit.status === 'confirmed' ? 'Funds credited' : deposit.status === 'rejected' ? 'Funding declined' : 'Funding under review',
      body: `₦${Number(deposit.amount).toLocaleString()} wallet funding ${deposit.status === 'confirmed' ? 'was added to your balance.' : 'is being processed.'}`,
      date: deposit.created_at,
    })),
    ...withdrawals.map(withdrawal => ({
      id: `withdrawal-${withdrawal.id}`,
      type: 'withdrawal' as const,
      title: withdrawal.status === 'paid' ? 'Withdrawal paid' : withdrawal.status === 'rejected' ? 'Withdrawal declined' : 'Withdrawal queued',
      body: `₦${Number(withdrawal.amount).toLocaleString()} withdrawal ${withdrawal.status === 'paid' ? 'has been processed.' : 'is awaiting the payout window.'}`,
      date: withdrawal.processed_at ?? withdrawal.requested_at,
    })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()), [completions, deposits, withdrawals]);
  const unreadCount = notifications.filter(notification => !readIds.includes(notification.id)).length;

  function markAllRead() {
    const ids = notifications.map(notification => notification.id);
    setReadIds(ids);
    localStorage.setItem('mrhustler-read-notifications', JSON.stringify(ids));
  }

  function icon(type: NotificationItem['type']) {
    if (type === 'task') return <CheckCircle size={16} className="text-green-400" />;
    if (type === 'funding') return <WalletCards size={16} className="text-blue-400" />;
    if (type === 'withdrawal') return <CreditCard size={16} className="text-amber-400" />;
    return <Bell size={16} className="text-purple-400" />;
  }

  return <aside className="fixed right-4 top-20 z-50 w-[min(390px,calc(100vw-2rem))] overflow-hidden border border-white/10 bg-[#111] shadow-2xl" aria-label="Notifications">
    <header className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 className="font-bold text-white">Notifications</h2><p className="text-[11px] text-gray-500">{unreadCount} unread update{unreadCount === 1 ? '' : 's'}</p></div><div className="flex items-center gap-1"><button onClick={markAllRead} disabled={!unreadCount} className="rounded px-2 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-400/10 disabled:opacity-40">Mark All as Read</button><button onClick={onClose} aria-label="Close notifications" className="p-2 text-gray-400 hover:text-white"><X size={16} /></button></div></header>
    <div className="max-h-[min(520px,70vh)] overflow-y-auto">{notifications.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">No notifications yet.</p> : notifications.map(notification => <article key={notification.id} className={`flex gap-3 border-b border-white/6 px-4 py-3 ${readIds.includes(notification.id) ? 'opacity-60' : 'bg-amber-400/5'}`}><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">{icon(notification.type)}</div><div className="min-w-0"><div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold text-white">{notification.title}</h3>{!readIds.includes(notification.id) && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />}</div><p className="mt-1 text-xs leading-relaxed text-gray-400">{notification.body}</p><time className="mt-1 block text-[10px] text-gray-600">{new Date(notification.date).toLocaleString('en-NG')}</time></div></article>)}</div>
    <footer className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-gray-500"><Clock size={13} /> Updates refresh with your dashboard activity.</footer>
  </aside>;
}
