import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Submission = {
  id: string;
  user_id: string;
  plan_code: string;
  amount: number;
  provider: string;
  payment_method: string;
  payment_proof: string | null;
  created_at: string;
};

export default function AdminSubscriptionReviewPanel() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('user_subscriptions').select('id, user_id, plan_code, amount, provider, payment_method, payment_proof, created_at').eq('status', 'pending').order('created_at', { ascending: false });
    if (error) setMessage(error.message);
    setSubmissions((data ?? []) as Submission[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function review(id: string, decision: 'activate' | 'decline') {
    const { error } = await supabase.rpc('admin_review_plan_subscription', { p_subscription_id: id, p_decision: decision });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(decision === 'activate' ? 'Subscription activated.' : 'Subscription declined.');
    await load();
  }

  return (
    <section className="space-y-4">
      <div><p className="text-xs font-bold uppercase tracking-wider text-amber-300">Membership review</p><h2 className="mt-1 text-xl font-black">Pending plan submissions</h2><p className="mt-1 text-sm text-gray-400">Gateway confirmations activate automatically. Manual proof submissions require an admin decision.</p></div>
      {message && <div role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</div>}
      {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} /> Loading submissions</p> : submissions.length === 0 ? <p className="py-12 text-center text-sm text-gray-500">No pending plan submissions.</p> : submissions.map(submission => (
        <article key={submission.id} className="border-b border-white/8 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h3 className="font-bold">{submission.plan_code.toUpperCase()} · ₦{Number(submission.amount).toLocaleString()}</h3><p className="mt-1 text-xs text-gray-400">User {submission.user_id} · {submission.payment_method} · {new Date(submission.created_at).toLocaleString('en-NG')}</p>{submission.payment_proof && <p className="mt-3 whitespace-pre-wrap border border-white/8 bg-white/5 p-3 text-sm text-gray-300">{submission.payment_proof}</p>}</div>
            <div className="flex gap-2"><button onClick={() => review(submission.id, 'activate')} className="flex items-center gap-1.5 rounded bg-emerald-300 px-3 py-2 text-xs font-bold text-black"><Check size={14} /> Activate</button><button onClick={() => review(submission.id, 'decline')} className="flex items-center gap-1.5 rounded border border-red-300/25 px-3 py-2 text-xs text-red-300"><X size={14} /> Decline</button></div>
          </div>
        </article>
      ))}
    </section>
  );
}
