import { useCallback, useEffect, useState } from 'react';
import { Banknote, Copy, CreditCard, Loader2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type FundingSettings = { enabled: boolean; bank_name: string; account_name: string; account_number: string; instructions: string };
type Deposit = { id: string; amount: number; payment_method: string; provider_reference: string | null; status: string; created_at: string; review_note: string | null };

const emptySettings: FundingSettings = { enabled: false, bank_name: '', account_name: '', account_number: '', instructions: 'Transfer the exact amount, then submit your proof of payment.' };

export default function FundAccountPanel({ userId }: { userId: string }) {
  const [settings, setSettings] = useState(emptySettings);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [fundBalance, setFundBalance] = useState(0);
  const [method, setMethod] = useState<'paystack' | 'flutterwave' | 'manual'>('paystack');
  const [amount, setAmount] = useState('');
  const [proof, setProof] = useState('');
  const [proofFile, setProofFile] = useState<File | undefined>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [settingsResult, depositsResult, balanceResult] = await Promise.all([
      supabase.from('funding_settings').select('enabled, bank_name, account_name, account_number, instructions').eq('singleton', true).maybeSingle(),
      supabase.from('funding_deposits').select('id, amount, payment_method, provider_reference, status, created_at, review_note').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      supabase.from('balances').select('fund_balance').eq('user_id', userId).maybeSingle(),
    ]);
    if (settingsResult.error || depositsResult.error || balanceResult.error) setMessage((settingsResult.error ?? depositsResult.error ?? balanceResult.error)?.message ?? 'Could not load funding details.');
    setSettings((settingsResult.data as FundingSettings | null) ?? emptySettings);
    setDeposits((depositsResult.data ?? []) as Deposit[]);
    setFundBalance(Number(balanceResult.data?.fund_balance ?? 0));
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    let uploadedPath: string | null = null;
    try {
      if (method === 'manual' && proofFile) {
        const safeName = proofFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        uploadedPath = `${userId}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage.from('funding-proofs').upload(uploadedPath, proofFile, { contentType: proofFile.type, upsert: false });
        if (error) throw error;
      }
      const { error } = await supabase.rpc('submit_funding_deposit', { p_amount: Number(amount), p_payment_method: method, p_proof_text: method === 'manual' ? proof : null, p_proof_path: uploadedPath });
      if (error) throw error;
      setMessage(method === 'manual' ? 'Payment proof submitted. Admin approval is required before your Fund Wallet is credited.' : `${method === 'paystack' ? 'Paystack' : 'Flutterwave'} payment initialized. Your Fund Wallet is credited after provider confirmation.`);
      setAmount(''); setProof(''); setProofFile(undefined);
      await load();
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('funding-proofs').remove([uploadedPath]);
      setMessage(error instanceof Error ? error.message : 'Funding submission failed.');
    } finally { setSubmitting(false); }
  }

  async function copy(value: string) { await navigator.clipboard.writeText(value); setMessage('Account detail copied.'); }

  return (
    <div className="space-y-6">
      <div className="border border-orange-400/20 bg-orange-400/[0.04] p-5"><p className="text-xs font-bold uppercase tracking-wider text-orange-200">Fund Wallet</p><p className="mt-2 text-3xl font-black text-white">₦{fundBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p><p className="mt-1 text-xs text-gray-400">Deposited funds are reserved for campaign sponsorship.</p></div>
      {message && <div role="status" className="border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">{message}</div>}
      {loading ? <div className="flex min-h-40 items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin" size={17} /> Loading funding options</div> : !settings.enabled ? <div className="border border-blue-400/20 bg-blue-400/5 p-5 text-sm text-blue-300">Wallet funding is temporarily unavailable. Please check back when the admin enables a deposit method.</div> : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="border border-white/8 bg-[#111] p-5">
              <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-400/10"><Banknote size={18} className="text-orange-300" /></div><div><h3 className="font-bold text-white">Manual bank transfer</h3><p className="text-xs text-gray-400">Admin verifies your proof before crediting your Fund Wallet.</p></div></div>
              <div className="mt-5 space-y-3 text-sm"><Detail label="Bank" value={settings.bank_name} onCopy={copy} /><Detail label="Account name" value={settings.account_name} onCopy={copy} /><Detail label="Account number" value={settings.account_number} onCopy={copy} /></div>
              <p className="mt-4 text-xs leading-relaxed text-gray-400">{settings.instructions}</p>
            </section>
            <section className="border border-white/8 bg-[#111] p-5"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10"><CreditCard size={18} className="text-amber-400" /></div><div><h3 className="font-bold text-white">Choose payment method</h3><p className="text-xs text-gray-400">Gateway deposits credit after trusted confirmation.</p></div></div>
              <form onSubmit={submit} className="mt-5 space-y-4"><label className="block text-xs text-gray-400">Amount (NGN)<input required type="number" min="1" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="admin-input mt-1" /></label><div className="grid grid-cols-3 gap-2">{(['paystack', 'flutterwave', 'manual'] as const).map(value => <button type="button" key={value} onClick={() => setMethod(value)} className={`border p-2 text-xs font-bold capitalize ${method === value ? 'border-amber-300 bg-amber-300/10 text-amber-200' : 'border-white/10 text-gray-400'}`}>{value}</button>)}</div>{method === 'manual' && <><textarea required={proofFile === undefined} minLength={5} maxLength={4000} rows={3} value={proof} onChange={event => setProof(event.target.value)} placeholder="Describe the transfer or enter its reference" className="admin-input resize-y" /><label className="block text-xs text-gray-400">Payment screenshot or PDF<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={event => setProofFile(event.target.files?.[0])} className="mt-1 block w-full text-xs text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-white" /></label></>}<button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{submitting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}{method === 'manual' ? 'Submit payment proof' : `Continue with ${method}`}</button></form>
            </section>
          </div>
          <section className="border border-white/8 bg-[#111] p-5"><h3 className="font-bold text-white">Funding history</h3>{deposits.length === 0 ? <p className="mt-4 text-sm text-gray-500">No funding submissions yet.</p> : <div className="mt-3 divide-y divide-white/8">{deposits.map(deposit => <div key={deposit.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-semibold text-white">₦{Number(deposit.amount).toLocaleString()} · <span className="capitalize">{deposit.payment_method}</span></p><p className="text-xs text-gray-500">{new Date(deposit.created_at).toLocaleString('en-NG')}</p></div><span className={`text-xs font-bold capitalize ${deposit.status === 'confirmed' ? 'text-green-400' : deposit.status === 'rejected' ? 'text-red-400' : 'text-amber-400'}`}>{deposit.status}</span></div>)}</div>}</section>
        </>
      )}
    </div>
  );
}

function Detail({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
  return <div className="flex items-center justify-between gap-3 border border-white/8 bg-white/3 px-3 py-2"><div><p className="text-[11px] text-gray-500">{label}</p><p className="font-semibold text-white">{value || 'Admin has not configured this yet'}</p></div>{value && <button type="button" onClick={() => onCopy(value)} aria-label={`Copy ${label}`} className="p-2 text-gray-400 hover:text-amber-300"><Copy size={14} /></button>}</div>;
}
