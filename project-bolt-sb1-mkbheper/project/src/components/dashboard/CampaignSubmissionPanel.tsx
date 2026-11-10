import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Submission = { id: string; title: string; budget: number; status: string; review_note: string | null; created_at: string };
const initialForm = { title: '', description: '', category: 'General', reward: '', quantity: '1', taskUrl: '', proofInstructions: 'Describe the action completed and attach evidence.' };

export default function CampaignSubmissionPanel({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [fundBalance, setFundBalance] = useState(0);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [{ data: balance }, { data: rows }] = await Promise.all([
      supabase.from('balances').select('fund_balance').eq('user_id', userId).maybeSingle(),
      supabase.from('campaign_submissions').select('id, title, budget, status, review_note, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
    ]);
    setFundBalance(Number(balance?.fund_balance ?? 0));
    setSubmissions((rows ?? []) as Submission[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    const { error } = await supabase.rpc('submit_campaign', {
      p_title: form.title,
      p_description: form.description,
      p_category: form.category,
      p_reward: Number(form.reward),
      p_quantity: Number(form.quantity),
      p_task_url: form.taskUrl,
      p_proof_instructions: form.proofInstructions,
    });
    setSubmitting(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setForm(initialForm);
    setMessage('Hustle campaign submitted for admin approval. Funds are reserved from your Fund Wallet only after approval.');
    await load();
  }

  const budget = Number(form.reward || 0) * Number(form.quantity || 0);

  return (
    <section className="space-y-4 border-b border-white/8 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-bold text-white">Create a sponsored hustle</h2><p className="mt-1 text-xs text-gray-500">Submit a campaign for approval. Approved budgets are charged to your Fund Wallet.</p></div>
        <button onClick={() => setOpen(current => !current)} className="flex items-center gap-2 border border-orange-300/30 px-3 py-2 text-xs font-bold text-orange-200 hover:bg-orange-300/10">{open ? 'Close form' : <><Plus size={14} /> Submit campaign</>}</button>
      </div>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300">{message}</p>}
      {open && <form onSubmit={submit} className="grid gap-3 border border-white/8 bg-white/[0.02] p-4 sm:grid-cols-2">
        <label className="text-xs text-gray-400">Hustle title<input required minLength={4} maxLength={120} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} className="campaign-input mt-1" /></label>
        <label className="text-xs text-gray-400">Category<input required minLength={2} maxLength={80} value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} className="campaign-input mt-1" /></label>
        <label className="text-xs text-gray-400 sm:col-span-2">Description<textarea required minLength={10} maxLength={2000} rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className="campaign-input mt-1 resize-y" /></label>
        <label className="text-xs text-gray-400">Reward per hustle (NGN)<input required type="number" min="0.01" step="0.01" value={form.reward} onChange={event => setForm({ ...form, reward: event.target.value })} className="campaign-input mt-1" /></label>
        <label className="text-xs text-gray-400">Available submissions<input required type="number" min="1" max="1000" step="1" value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })} className="campaign-input mt-1" /></label>
        <label className="text-xs text-gray-400 sm:col-span-2">Destination URL<input required type="url" value={form.taskUrl} onChange={event => setForm({ ...form, taskUrl: event.target.value })} className="campaign-input mt-1" placeholder="https://" /></label>
        <label className="text-xs text-gray-400 sm:col-span-2">Proof instructions<textarea required minLength={5} maxLength={1000} rows={2} value={form.proofInstructions} onChange={event => setForm({ ...form, proofInstructions: event.target.value })} className="campaign-input mt-1 resize-y" /></label>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2"><p className="text-xs text-gray-400">Budget ₦{budget.toLocaleString('en-NG', { minimumFractionDigits: 2 })} · Fund Wallet ₦{fundBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p><button disabled={submitting || loading || budget <= 0 || budget > fundBalance} className="flex items-center gap-2 bg-orange-400 px-4 py-2.5 text-xs font-bold text-black disabled:opacity-40">{submitting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}Send for approval</button></div>
      </form>}
      {!loading && submissions.length > 0 && <div className="divide-y divide-white/8 border-y border-white/8">{submissions.map(submission => <article key={submission.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-semibold text-white">{submission.title}</p><p className="mt-1 text-xs text-gray-500">₦{Number(submission.budget).toLocaleString('en-NG')} · {new Date(submission.created_at).toLocaleDateString('en-NG')}</p>{submission.review_note && <p className="mt-1 text-xs text-gray-400">{submission.review_note}</p>}</div><span className={`text-xs font-bold capitalize ${submission.status === 'approved' ? 'text-orange-200' : submission.status === 'rejected' ? 'text-gray-300' : 'text-amber-200'}`}>{submission.status}</span></article>)}</div>}
      <style>{`.campaign-input{width:100%;border:1px solid rgba(255,255,255,.1);background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.campaign-input:focus{border-color:rgba(251,146,60,.55)}`}</style>
    </section>
  );
}
