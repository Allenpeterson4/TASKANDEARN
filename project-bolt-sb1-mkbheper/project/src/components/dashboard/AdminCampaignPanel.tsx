import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Campaign = { id: string; user_id: string; title: string; description: string; category: string; reward: number; quantity: number; budget: number; task_url: string; proof_instructions: string; created_at: string };

export default function AdminCampaignPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('campaign_submissions').select('*').eq('status', 'pending').order('created_at');
    if (error) setMessage(error.message);
    setCampaigns((data ?? []) as Campaign[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function review(campaign: Campaign, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !notes[campaign.id]?.trim()) {
      setMessage('Add a short reason before rejecting a campaign.');
      return;
    }
    setSavingId(campaign.id);
    const { error } = await supabase.rpc('admin_review_campaign_submission', {
      p_submission_id: campaign.id,
      p_decision: decision,
      p_review_note: notes[campaign.id]?.trim() || null,
    });
    setSavingId(null);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(decision === 'approve' ? 'Campaign approved, funded, and published as a hustle.' : 'Campaign rejected; the Fund Wallet was not charged.');
    await load();
  }

  return (
    <section className="space-y-4">
      <div><h2 className="text-lg font-bold">Pending hustle campaigns</h2><p className="mt-1 text-xs text-gray-500">Approval debits the campaign budget from the submitter's Fund Wallet. Rejecting does not charge it.</p></div>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}
      {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading campaigns</p> : campaigns.length === 0 ? <p className="py-12 text-center text-sm text-gray-500">No campaigns awaiting approval.</p> : campaigns.map(campaign => <article key={campaign.id} className="border-b border-white/10 py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-white">{campaign.title}</h3><span className="border border-orange-300/20 px-2 py-0.5 text-[10px] text-orange-200">{campaign.category}</span></div><p className="mt-2 text-sm leading-relaxed text-gray-400">{campaign.description}</p><p className="mt-2 break-all text-xs text-gray-500">{campaign.task_url}</p><p className="mt-2 text-xs text-gray-400">Submitter {campaign.user_id} · {campaign.quantity} hustles · ₦{Number(campaign.reward).toLocaleString()} each · ₦{Number(campaign.budget).toLocaleString()} total</p><p className="mt-1 text-xs text-gray-500">Proof: {campaign.proof_instructions}</p></div></div><div className="mt-4 grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><input maxLength={500} value={notes[campaign.id] ?? ''} onChange={event => setNotes(current => ({ ...current, [campaign.id]: event.target.value }))} placeholder="Optional approval note or rejection reason" className="admin-input" /><button onClick={() => void review(campaign, 'approve')} disabled={savingId === campaign.id} className="flex items-center justify-center gap-1.5 bg-orange-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{savingId === campaign.id ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}Approve</button><button onClick={() => void review(campaign, 'reject')} disabled={savingId === campaign.id || !notes[campaign.id]?.trim()} className="flex items-center justify-center gap-1.5 border border-white/15 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><X size={14} />Reject</button></div></article>)}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,146,60,.55)}`}</style>
    </section>
  );
}
