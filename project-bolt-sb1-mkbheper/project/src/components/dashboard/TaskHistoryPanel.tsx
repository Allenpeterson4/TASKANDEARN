import { BadgeCheck, CheckCircle, CircleDollarSign, ClipboardList, Clock3, History, XCircle } from 'lucide-react';
import type { Task, TaskCompletion } from '@/lib/supabase';

interface Props {
  tasks: Task[];
  completions: TaskCompletion[];
}

export default function TaskHistoryPanel({ tasks, completions }: Props) {
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const history = [...completions]
    .filter(completion => completion.status !== 'rejected')
    .sort((left, right) => new Date(right.completed_at).getTime() - new Date(left.completed_at).getTime());
  const approvedEarnings = history.reduce((total, completion) => (
    completion.status === 'approved' ? total + Number(taskMap.get(completion.task_id)?.reward ?? 0) : total
  ), 0);
  return (
    <div className="space-y-6">
      <div><p className="text-xs font-bold uppercase tracking-wider text-amber-400">Activity</p><h2 className="mt-1 text-xl font-black text-white">Task History</h2><p className="mt-1 text-sm text-gray-400">Every task you have submitted and its current verification status.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard title="Completed-task earnings" subtitle="Approved reward performance" accent="green" icon={<CircleDollarSign size={18} />}>
          <MetricItem icon={<CircleDollarSign size={15} />} label="All-time approved rewards" value={`₦${approvedEarnings.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`} />
          <MetricItem icon={<BadgeCheck size={15} />} label="Approved tasks" value={history.filter(completion => completion.status === 'approved').length.toLocaleString()} />
        </MetricCard>
        <MetricCard title="Task activity" subtitle="Your current verification pipeline" accent="amber" icon={<ClipboardList size={18} />}>
          <MetricItem icon={<ClipboardList size={15} />} label="Tasks submitted" value={history.length.toLocaleString()} />
          <MetricItem icon={<Clock3 size={15} />} label="Awaiting review" value={history.filter(completion => completion.status === 'pending').length.toLocaleString()} />
        </MetricCard>
      </div>
      <section className="overflow-hidden border border-white/8 bg-[#111]">
        <div className="hidden grid-cols-[minmax(0,1.5fr)_150px_130px_150px] gap-4 border-b border-white/8 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 sm:grid"><span>Task</span><span>Completed</span><span>Reward</span><span>Status</span></div>
        {history.length === 0 ? <div className="py-16 text-center"><History size={36} className="mx-auto mb-3 text-gray-600" /><p className="text-sm text-gray-500">Completed tasks will appear here.</p></div> : <div className="divide-y divide-white/8">{history.map(completion => { const task = taskMap.get(completion.task_id); return <article key={completion.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1.5fr)_150px_130px_150px] sm:items-center sm:gap-4"><div><p className="font-semibold text-white">{task?.title ?? 'Task'}</p><p className="mt-1 text-xs text-gray-500">{task?.category ?? 'Task activity'} · {task?.difficulty ?? 'Completed task'}</p></div><p className="text-xs text-gray-400">{new Date(completion.completed_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}</p><p className="text-sm font-bold text-green-400">₦{Number(task?.reward ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p><Status status={completion.status} /></article>; })}</div>}
      </section>
    </div>
  );
}

function MetricCard({ title, subtitle, accent, icon, children }: { title: string; subtitle: string; accent: 'green' | 'amber'; icon: React.ReactNode; children: React.ReactNode }) {
  const styles = accent === 'green' ? 'border-green-400/20 bg-gradient-to-br from-green-400/10 to-transparent text-green-400' : 'border-amber-400/20 bg-gradient-to-br from-amber-400/10 to-transparent text-amber-400';
  return <section className={`rounded-2xl border p-5 ${styles}`}><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/10">{icon}</div><div><h3 className="text-sm font-bold text-white">{title}</h3><p className="mt-1 text-xs text-gray-400">{subtitle}</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{children}</div></section>;
}

function MetricItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="border border-white/8 bg-black/10 p-3"><div className="flex items-center gap-2 text-gray-400">{icon}<span className="text-[11px] leading-tight">{label}</span></div><p className="mt-2 text-xl font-black text-white">{value}</p></div>;
}

function Status({ status }: { status: string }) {
  if (status === 'approved') return <span className="inline-flex items-center gap-1.5 text-xs font-bold text-green-400"><CheckCircle size={14} /> Approved</span>;
  if (status === 'rejected') return <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-400"><XCircle size={14} /> Rejected</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400"><Clock3 size={14} /> Pending review</span>;
}
