import { useEffect, useState } from 'react';
import { Zap, CheckCircle, Clock, Filter, Loader2, ClipboardList, ExternalLink, Lock, ChevronDown } from 'lucide-react';
import type { Task, TaskCompletion } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

interface Props {
  tasks: Task[];
  completions: TaskCompletion[];
  userId: string;
  currentPlanCode: string;
  availablePlanCodes: string[];
  onUpgrade: () => void;
  onCompletionAdded: (c: TaskCompletion) => void;
  onBalanceUpdated: (balance: { reward_balance: number; referral_balance: number; total_earned: number }) => void;
}

const planRanks: Record<string, number> = { free: 0, premium: 1, vip: 2 };

export default function TasksPanel({ tasks, completions, userId, currentPlanCode, availablePlanCodes, onUpgrade, onCompletionAdded, onBalanceUpdated }: Props) {
  const [cat, setCat] = useState('All');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [proofs, setProofs] = useState<Record<string, string>>({});
  const [proofFiles, setProofFiles] = useState<Record<string, File | undefined>>({});
  const [expandedProof, setExpandedProof] = useState<Record<string, boolean>>({});

  const taskCompletionMap = new Map(completions.map(completion => [completion.task_id, completion]));
  const categories = ['All', ...new Set(tasks.map(task => task.category))];

  useEffect(() => {
    if (cat !== 'All' && !tasks.some(task => task.category === cat)) setCat('All');
  }, [cat, tasks]);

  useEffect(() => {
    if (!tasks.some(task => task.verification_mode === 'automatic')) return;

    let active = true;
    async function refreshVerifiedTask() {
      const [{ data: latestCompletions }, { data: latestBalance }] = await Promise.all([
        supabase.from('task_completions').select('*').eq('user_id', userId),
        supabase.from('balances').select('reward_balance, referral_balance, total_earned').eq('user_id', userId).maybeSingle(),
      ]);
      if (!active) return;
      const currentIds = new Set(completions.map(completion => completion.id));
      for (const completion of (latestCompletions ?? []) as TaskCompletion[]) {
        if (!currentIds.has(completion.id)) onCompletionAdded(completion);
      }
      if (latestBalance) onBalanceUpdated(latestBalance);
    }

    const refresh = () => { void refreshVerifiedTask(); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [completions, onBalanceUpdated, onCompletionAdded, tasks, userId]);

  const filtered = tasks.filter(t =>
    cat === 'All' || t.category === cat
  );

  const completedCount = completions.filter(completion => completion.status !== 'rejected').length;

  async function startTask(task: Task) {
    const existingCompletion = taskCompletionMap.get(task.id);
    if (existingCompletion && existingCompletion.status !== 'rejected') return;
    const proofText = proofs[task.id]?.trim() ?? '';
    const proofFile = proofFiles[task.id];
    if (!proofText && !proofFile) {
      showToast('Add proof text or a screenshot before submitting this task.');
      return;
    }
    setSubmitting(task.id);
    let uploadedPath: string | null = null;
    try {
      if (proofFile) {
        const safeName = proofFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        uploadedPath = `${userId}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from('task-proofs').upload(uploadedPath, proofFile, {
          contentType: proofFile.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
      }
      const { data, error } = await supabase.rpc('claim_task', {
        p_task_id: task.id,
        p_proof_text: proofText || null,
        p_proof_path: uploadedPath,
      });
      if (error) throw error;
      onCompletionAdded(data as TaskCompletion);
      setProofFiles(current => ({ ...current, [task.id]: undefined }));
      showToast(`Task submitted! ₦${task.reward.toLocaleString()} pending verification.`);
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('task-proofs').remove([uploadedPath]);
      const message = error instanceof Error ? error.message : 'Unknown submission error';
      showToast(`Could not submit task: ${message}`);
    } finally {
      setSubmitting(null);
    }
  }

  async function startTrackedTask(task: Task) {
    setSubmitting(task.id);
    try {
      const { data, error } = await supabase.rpc('start_task_verification', {
        p_task_id: task.id,
      });
      if (error) throw error;
      const session = data as { id: string };
      const destination = new URL(task.task_url);
      destination.searchParams.set('tracking_id', session.id);
      window.location.assign(destination.toString());
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start task tracking.');
      setSubmitting(null);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a1a] border border-white/10 rounded-2xl px-5 py-3 text-white text-sm shadow-2xl flex items-center gap-3 max-w-sm">
          <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          <span className="text-gray-400 text-sm">Filter:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                cat === c
                  ? 'bg-amber-400 text-black'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/5'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Tasks count */}
      <p className="text-gray-400 text-sm">
        Showing <span className="text-white font-semibold">{filtered.length}</span> tasks ·{' '}
        <span className="text-green-400">{completedCount} completed</span>
      </p>

      {/* Task grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        {filtered.map(task => {
          const completion = taskCompletionMap.get(task.id);
          const done = !!completion && completion.status !== 'rejected';
          const isSubmitting = submitting === task.id;
          const taskPlanRank = planRanks[task.required_plan_code] ?? 0;
          const userPlanRank = planRanks[currentPlanCode] ?? 0;
          const planLocked = taskPlanRank > userPlanRank;
          const requiredPlanUnavailable = planLocked && !availablePlanCodes.includes(task.required_plan_code);
          const campaignUnavailable = !task.is_funded;
          const locked = planLocked || campaignUnavailable;

          return (
            <div
              key={task.id}
              className={`bg-[#111] border rounded-2xl p-5 transition-all duration-300 ${
                done
                  ? 'border-green-500/15 opacity-70'
                  : 'border-white/6 hover:border-amber-400/20 hover:-translate-y-0.5'
              }`}
            >
              <div className="mb-3">
                <span className="text-xs text-gray-500 bg-white/5 px-2.5 py-1 rounded-lg">
                  {task.category}
                </span>
              </div>

              <h3 className="text-white font-bold text-sm mb-2">{task.title}</h3>
              <p className="text-gray-400 text-xs leading-relaxed mb-4">{task.description}</p>
              {task.task_url && task.is_funded && (
                <button
                  type="button"
                  onClick={() => {
                    if (task.verification_mode === 'automatic') void startTrackedTask(task);
                    else window.open(task.task_url, '_blank', 'noopener,noreferrer');
                  }}
                  disabled={isSubmitting || done}
                  className="mb-4 inline-flex items-center gap-1.5 text-amber-400 text-xs font-semibold hover:text-amber-300 disabled:opacity-50"
                >
                  {task.verification_mode === 'automatic' ? 'Start tracked task' : 'Open task'} <ExternalLink size={13} />
                </button>
              )}
              {task.verification_mode === 'manual' && !done && !locked && expandedProof[task.id] && (
                <div className="mb-4">
                  <label className="block text-xs text-gray-400 mb-1.5">
                    {task.proof_instructions || 'Describe the completed action or upload a screenshot for manual review.'}
                  </label>
                  <textarea
                    value={proofs[task.id] ?? ''}
                    onChange={event => setProofs(current => ({ ...current, [task.id]: event.target.value }))}
                    maxLength={2000}
                    rows={2}
                    className="w-full resize-y bg-[#0a0a0a] border border-white/8 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-400/50"
                  />
                  <label className="mt-2 block text-xs text-gray-500">
                    Optional screenshot (PNG, JPEG, or WebP; up to 10 MB)
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={event => setProofFiles(current => ({ ...current, [task.id]: event.target.files?.[0] }))}
                      className="mt-1 block w-full text-xs text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-white"
                    />
                    {proofFiles[task.id] && <span className="mt-1 block text-amber-400">{proofFiles[task.id]?.name}</span>}
                  </label>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-400 font-black text-lg">₦{task.reward.toLocaleString()}</p>
                  <p className="text-gray-600 text-xs">Reward</p>
                </div>
                <button
                  disabled={done || isSubmitting || (campaignUnavailable && !planLocked) || requiredPlanUnavailable}
                  onClick={() => {
                    if (planLocked) onUpgrade();
                    else if (task.verification_mode === 'automatic') void startTrackedTask(task);
                    else if (!expandedProof[task.id]) setExpandedProof(current => ({ ...current, [task.id]: true }));
                    else void startTask(task);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    done || requiredPlanUnavailable || (campaignUnavailable && !planLocked)
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20 cursor-default'
                      : 'bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 disabled:opacity-60'
                  }`}
                >
                  {isSubmitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : done ? (
                    <><CheckCircle size={14} /> Submitted</>
                  ) : planLocked ? (
                    requiredPlanUnavailable ? 'Plan unavailable' : <><Lock size={14} /> Upgrade plan</>
                  ) : campaignUnavailable ? (
                    'Awaiting sponsor funding'
                  ) : task.verification_mode === 'automatic' ? (
                    'Start tracked task'
                  ) : (
                    <><Zap size={14} /> Complete Task <ChevronDown size={14} /></>
                  )}
                </button>
              </div>

              {planLocked && !campaignUnavailable && <p className="mt-3 text-xs text-amber-300">Requires the {task.required_plan_code[0].toUpperCase() + task.required_plan_code.slice(1)} plan.</p>}
              {planLocked && campaignUnavailable && <p className="mt-3 text-xs text-amber-300">Requires {task.required_plan_code} access; this sponsor campaign is also still being configured.</p>}
              {!planLocked && campaignUnavailable && <p className="mt-3 text-xs text-gray-500">This sponsor campaign is being configured and cannot be claimed yet.</p>}

              {done && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-400/70 bg-amber-400/5 rounded-lg px-3 py-2">
                  <Clock size={12} />
                  {completion.status === 'approved' ? 'Task approved and reward credited' : 'Pending admin verification'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p>No tasks match your filter.</p>
        </div>
      )}
    </div>
  );
}
