import { useState } from 'react';
import { Zap, CheckCircle, Clock, Filter, Loader2 } from 'lucide-react';
import type { Task, TaskCompletion } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

interface Props {
  tasks: Task[];
  completions: TaskCompletion[];
  userId: string;
  onCompletionAdded: (c: TaskCompletion) => void;
}

const categories = ['All', 'Social Media', 'Survey', 'Review', 'App Install', 'Data Entry', 'Video', 'Sign-up', 'Referral'];
const difficulties = ['All', 'Easy', 'Medium', 'Hard'];
const diffColors: Record<string, string> = {
  Easy:   'text-green-400 bg-green-400/10 border-green-400/20',
  Medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  Hard:   'text-red-400 bg-red-400/10 border-red-400/20',
};

export default function TasksPanel({ tasks, completions, userId, onCompletionAdded }: Props) {
  const [cat, setCat] = useState('All');
  const [diff, setDiff] = useState('All');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const completedIds = new Set(completions.map(c => c.task_id));

  const filtered = tasks.filter(t =>
    (cat === 'All' || t.category === cat) &&
    (diff === 'All' || t.difficulty === diff)
  );

  async function startTask(task: Task) {
    if (completedIds.has(task.id)) return;
    setSubmitting(task.id);
    try {
      const { data, error } = await supabase
        .from('task_completions')
        .insert({ user_id: userId, task_id: task.id, status: 'pending' })
        .select()
        .single();
      if (error) throw error;
      onCompletionAdded(data as TaskCompletion);
      showToast(`Task submitted! ₦${task.reward.toLocaleString()} pending verification.`);
    } catch {
      showToast('Could not submit task. Please try again.');
    } finally {
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

      <div className="flex gap-2">
        {difficulties.map(d => (
          <button
            key={d}
            onClick={() => setDiff(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              diff === d
                ? 'bg-white/15 text-white border border-white/20'
                : 'bg-white/4 text-gray-500 hover:text-gray-300 border border-white/5'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Tasks count */}
      <p className="text-gray-400 text-sm">
        Showing <span className="text-white font-semibold">{filtered.length}</span> tasks ·{' '}
        <span className="text-green-400">{completedIds.size} completed</span>
      </p>

      {/* Task grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        {filtered.map(task => {
          const done = completedIds.has(task.id);
          const isSubmitting = submitting === task.id;

          return (
            <div
              key={task.id}
              className={`bg-[#111] border rounded-2xl p-5 transition-all duration-300 ${
                done
                  ? 'border-green-500/15 opacity-70'
                  : 'border-white/6 hover:border-amber-400/20 hover:-translate-y-0.5'
              }`}
            >
              {/* Category + difficulty */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-500 bg-white/5 px-2.5 py-1 rounded-lg">
                  {task.category}
                </span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${diffColors[task.difficulty] ?? ''}`}>
                  {task.difficulty}
                </span>
              </div>

              <h3 className="text-white font-bold text-sm mb-2">{task.title}</h3>
              <p className="text-gray-400 text-xs leading-relaxed mb-4">{task.description}</p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-400 font-black text-lg">₦{task.reward.toLocaleString()}</p>
                  <p className="text-gray-600 text-xs">Reward</p>
                </div>
                <button
                  disabled={done || isSubmitting}
                  onClick={() => startTask(task)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    done
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20 cursor-default'
                      : 'bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 disabled:opacity-60'
                  }`}
                >
                  {isSubmitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : done ? (
                    <><CheckCircle size={14} /> Submitted</>
                  ) : (
                    <><Zap size={14} /> Do Task</>
                  )}
                </button>
              </div>

              {done && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-400/70 bg-amber-400/5 rounded-lg px-3 py-2">
                  <Clock size={12} />
                  Pending admin verification
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
