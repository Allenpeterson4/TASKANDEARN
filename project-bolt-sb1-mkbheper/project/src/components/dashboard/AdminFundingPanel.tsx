import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Settings = { enabled: boolean; bank_name: string; account_name: string; account_number: string; instructions: string };
type Deposit = { id: string; user_id: string; amount: number; payment_method: string; provider_reference: string | null; proof_text: string | null; proof_path: string | null; status: string; created_at: string };
const initialSettings: Settings = { enabled: false, bank_name: '', account_name: '', account_number: '', instructions: 'Transfer the exact amount, then submit your proof of payment.' };

export default function AdminFundingPanel() {
  const [settings, setSettings] = useState(initialSettings);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const [settingsResult, depositsResult] = await Promise.all([
      supabase.from('funding_settings').select('*').eq('singleton', true).maybeSingle(),
      supabase.from('funding_deposits').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
    ]);
    if (settingsResult.error || depositsResult.error) setMessage((settingsResult.error ?? depositsResult.error)?.message ?? 'Could not load funding settings.');
    if (settingsResult.data) setSettings(settingsResult.data as Settings);
    setDeposits((depositsResult.data ?? []) as Deposit[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('funding_settings').update({ ...settings, updated_at: new Date().toISOString(), updated_by: (await supabase.auth.getUser()).data.user?.id }).eq('singleton', true);
    setSaving(false);
    setMessage(error ? error.message : 'Funding settings saved.');
  }

  async function review(id: string, decision: 'confirm' | 'reject') {
    const { error } = await supabase.rpc('admin_review_funding_deposit', { p_deposit_id: id, p_decision: decision, p_review_note: null });
    if (error) setMessage(error.message);
    else { setMessage(decision === 'confirm' ? 'Deposit confirmed and wallet credited.' : 'Deposit rejected.'); await load(); }
  }

  async function openProof(path: string) {
    const { data, error } = await supabase.storage.from('funding-proofs').createSignedUrl(path, 120);
    if (error) setMessage(error.message); else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  return <div className="space-y-8">
    <form onSubmit={save} className="max-w-2xl space-y-4">
      <div><p className="text-xs font-bold uppercase tracking-wider text-amber-300">Fund Wallet configuration</p><h2 className="mt-1 text-xl font-black">Funding account details</h2><p className="mt-1 text-sm text-gray-400">These details are shown to hustlers choosing manual bank transfer.</p></div>
      <label className="flex items-center gap-3 text-sm text-gray-300"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} className="accent-amber-400" /> Enable wallet funding submissions</label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-gray-400">Bank name<input required value={settings.bank_name} onChange={event => setSettings({ ...settings, bank_name: event.target.value })} className="admin-input mt-1" /></label><label className="text-xs text-gray-400">Account number<input required value={settings.account_number} onChange={event => setSettings({ ...settings, account_number: event.target.value })} className="admin-input mt-1" /></label></div>
      <label className="block text-xs text-gray-400">Account name<input required value={settings.account_name} onChange={event => setSettings({ ...settings, account_name: event.target.value })} className="admin-input mt-1" /></label>
      <label className="block text-xs text-gray-400">Hustler instructions<textarea required rows={3} value={settings.instructions} onChange={event => setSettings({ ...settings, instructions: event.target.value })} className="admin-input mt-1 resize-y" /></label>
      <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save funding settings</button>
    </form>
    {message && <div role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</div>}
    <section className="space-y-3"><div><h2 className="text-xl font-black">Pending deposits</h2><p className="mt-1 text-sm text-gray-400">Confirm manual proofs only after checking the bank transfer.</p></div>{loading ? <p className="py-8 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} /> Loading deposits</p> : deposits.length === 0 ? <p className="py-10 text-center text-sm text-gray-500">No pending wallet deposits.</p> : deposits.map(deposit => <article key={deposit.id} className="border-b border-white/8 py-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-bold">₦{Number(deposit.amount).toLocaleString()} · <span className="capitalize">{deposit.payment_method}</span></h3><p className="mt-1 text-xs text-gray-400">User {deposit.user_id} · {new Date(deposit.created_at).toLocaleString('en-NG')}</p>{deposit.provider_reference && <p className="mt-1 text-xs text-gray-500">Reference: {deposit.provider_reference}</p>}{deposit.proof_text && <p className="mt-3 whitespace-pre-wrap border border-white/8 bg-white/5 p-3 text-sm text-gray-300">{deposit.proof_text}</p>}{deposit.proof_path && <button onClick={() => openProof(deposit.proof_path!)} className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-300"><ExternalLink size={13} /> View proof</button>}</div><div className="flex gap-2"><button onClick={() => review(deposit.id, 'confirm')} className="flex items-center gap-1.5 rounded bg-emerald-300 px-3 py-2 text-xs font-bold text-black"><Check size={14} /> Confirm & credit</button><button onClick={() => review(deposit.id, 'reject')} className="flex items-center gap-1.5 rounded border border-red-300/25 px-3 py-2 text-xs text-red-300"><X size={14} /> Reject</button></div></div></article>)}</section>
    <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}`}</style>
  </div>;
}
