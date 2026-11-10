import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Banknote, CheckCircle, Copy, CreditCard, Loader2, ShieldCheck, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Plan = {
  plan_code: string;
  name: string;
  description: string;
  price: number;
  daily_task_limit: number;
  daily_earning_cap: number | null;
  max_withdrawal: number;
  billing_period: 'monthly' | 'lifetime';
  referral_commission_percent: number;
};

type PaymentMethod = 'paystack' | 'flutterwave' | 'manual';
type FundingSettings = { enabled: boolean; bank_name: string; account_name: string; account_number: string; instructions: string };

export default function PaymentSelectionPanel({ planCode, onBack }: { planCode: string; onBack: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [totalHustles, setTotalHustles] = useState(0);
  const [fundingSettings, setFundingSettings] = useState<FundingSettings | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('paystack');
  const [manualProof, setManualProof] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const loadPlan = useCallback(async () => {
    setLoading(true);
    const [planResult, taskResult, fundingResult] = await Promise.all([
      supabase.from('subscription_plans').select('plan_code, name, description, price, daily_task_limit, daily_earning_cap, max_withdrawal, billing_period, referral_commission_percent').eq('plan_code', planCode).eq('is_active', true).maybeSingle(),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('funding_settings').select('enabled, bank_name, account_name, account_number, instructions').eq('singleton', true).maybeSingle(),
    ]);
    if (planResult.error || taskResult.error || fundingResult.error || !planResult.data) setMessage(planResult.error?.message ?? taskResult.error?.message ?? fundingResult.error?.message ?? 'This plan is no longer available.');
    setPlan((planResult.data as Plan | null) ?? null);
    setTotalHustles(taskResult.count ?? 0);
    setFundingSettings((fundingResult.data as FundingSettings | null) ?? null);
    setLoading(false);
  }, [planCode]);

  useEffect(() => { void loadPlan(); }, [loadPlan]);

  async function submitPayment() {
    if (!plan) return;
    setSubmitting(true);
    setMessage('');
    const result = method === 'manual'
      ? await supabase.rpc('submit_manual_plan_payment', { p_plan_code: plan.plan_code, p_payment_proof: manualProof })
      : await supabase.rpc('submit_gateway_plan_payment', { p_plan_code: plan.plan_code, p_provider: method });
    setSubmitting(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setMessage(method === 'manual' ? 'Payment proof submitted for admin approval.' : `${method === 'paystack' ? 'Paystack' : 'Flutterwave'} payment initialized. Your plan activates automatically after provider confirmation.`);
    setManualProof('');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft size={16} /> Back to Plans & Membership</button>
      {loading ? <div className="flex min-h-56 items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin" size={18} /> Loading plan details</div> : !plan ? <div className="border border-red-400/20 bg-red-400/5 p-5 text-sm text-red-300">{message || 'Plan unavailable.'}</div> : <>
        <section className="border border-amber-400/20 bg-gradient-to-br from-amber-400/10 to-orange-500/5 p-6"><p className="text-xs font-bold uppercase tracking-wider text-amber-300">Secure upgrade checkout</p><div className="mt-2 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-black text-white">Upgrade to {plan.name}</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-300">{plan.description || 'Unlock more earning access and higher hustle limits.'}</p></div><p className="text-3xl font-black text-amber-300">₦{Number(plan.price).toLocaleString()}</p></div><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Available hustles" value={totalHustles.toLocaleString()} /><Metric label="Daily access" value={plan.daily_task_limit >= 2147483647 ? 'Unlimited' : `${plan.daily_task_limit}`} /><Metric label="Maximum withdrawal" value={`₦${Number(plan.max_withdrawal).toLocaleString()}`} /><Metric label="Earning limit" value={plan.daily_earning_cap === null ? 'No daily cap' : `₦${Number(plan.daily_earning_cap).toLocaleString()}/day`} /><Metric label="Term" value={plan.billing_period === 'lifetime' ? 'Lifetime' : 'Monthly'} /></div>{plan.price > 0 && <p className="mt-4 text-xs text-gray-300">Includes a premium badge, priority support, custom referral code, and user-to-user transfers when enabled.</p>}</section>
        <section className="border border-white/8 bg-[#111] p-6"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-400/10"><CreditCard size={18} className="text-blue-400" /></div><div><h3 className="font-bold text-white">Choose payment method</h3><p className="text-xs text-gray-400">Automatic payments activate after trusted provider confirmation.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{(['paystack', 'flutterwave', 'manual'] as const).map(value => <button key={value} onClick={() => setMethod(value)} className={`border p-4 text-left ${method === value ? 'border-amber-300 bg-amber-300/10' : 'border-white/10 bg-white/3'}`}><p className="font-bold capitalize text-white">{value === 'manual' ? 'Manual proof' : value}</p><p className="mt-1 text-xs leading-relaxed text-gray-400">{value === 'manual' ? 'Submit payment details for admin review.' : 'Automatic confirmation and activation.'}</p></button>)}</div>{method === 'manual' && <><ManualTransferDetails settings={fundingSettings} /><textarea required value={manualProof} onChange={event => setManualProof(event.target.value)} rows={5} maxLength={4000} placeholder="Enter your transfer reference and payment details" className="admin-input mt-4 resize-y" /></>}{message && <p role="status" className="mt-4 border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">{message}</p>}<button onClick={submitPayment} disabled={submitting || (method === 'manual' && manualProof.trim().length < 5)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{submitting ? <Loader2 size={16} className="animate-spin" /> : method === 'manual' ? <CheckCircle size={16} /> : <WalletCards size={16} />}{submitting ? 'Submitting...' : method === 'manual' ? 'Submit proof for approval' : `Pay with ${method}`}</button></section>
        <p className="flex items-center justify-center gap-2 text-center text-xs text-gray-500"><ShieldCheck size={14} /> Your membership status is verified server-side before activation.</p>
      </>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-white/8 bg-white/3 p-3"><p className="text-[11px] text-gray-500">{label}</p><p className="mt-1 text-sm font-bold text-white">{value}</p></div>;
}

function ManualTransferDetails({ settings }: { settings: FundingSettings | null }) {
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }
  const detail = (label: string, value: string) => <div className="flex items-center justify-between gap-3 border border-white/8 bg-white/3 px-3 py-2"><div><p className="text-[11px] text-gray-500">{label}</p><p className="font-semibold text-white">{value || 'Admin has not configured this yet'}</p></div>{value && <button type="button" onClick={() => copy(value)} aria-label={`Copy ${label}`} className="p-2 text-gray-400 hover:text-amber-300"><Copy size={14} /></button>}</div>;
  return <div className="mt-4 border border-green-400/20 bg-green-400/5 p-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-400/10"><Banknote size={16} className="text-green-400" /></div><div><h4 className="text-sm font-bold text-white">Manual bank transfer</h4><p className="text-xs text-gray-400">Admin verifies your proof before activating the plan.</p></div></div><div className="mt-4 space-y-2">{detail('Bank', settings?.bank_name ?? '')}{detail('Account name', settings?.account_name ?? '')}{detail('Account number', settings?.account_number ?? '')}</div><p className="mt-3 text-xs leading-relaxed text-gray-400">{settings?.instructions ?? 'Transfer the exact plan amount, then submit your proof below.'}</p></div>;
}
