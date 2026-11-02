import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Plan = {
  plan_code: string;
  name: string;
  price: number;
  currency: string;
  daily_task_limit: number;
  daily_earning_cap: number | null;
  referral_commission_percent: number;
  is_active: boolean;
};

type PlanDraft = Omit<Plan, 'is_active'>;

const emptyPlan: PlanDraft = {
  plan_code: '',
  name: '',
  price: 0,
  currency: 'NGN',
  daily_task_limit: 30,
  daily_earning_cap: 4000,
  referral_commission_percent: 5,
};

export default function AdminPlansPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [draft, setDraft] = useState<PlanDraft>(emptyPlan);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function loadPlans() {
    setLoading(true);
    const { data, error } = await supabase.from('subscription_plans').select('*').order('price');
    if (error) setMessage(error.message);
    setPlans((data ?? []) as Plan[]);
    setLoading(false);
  }

  useEffect(() => {
    loadPlans();
  }, []);

  function edit(plan: Plan) {
    setEditingCode(plan.plan_code);
    setDraft({
      plan_code: plan.plan_code,
      name: plan.name,
      price: plan.price,
      currency: plan.currency,
      daily_task_limit: plan.daily_task_limit,
      daily_earning_cap: plan.daily_earning_cap,
      referral_commission_percent: plan.referral_commission_percent,
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const values = {
      ...draft,
      plan_code: draft.plan_code.trim().toLowerCase(),
      name: draft.name.trim(),
      updated_at: new Date().toISOString(),
    };
    const result = editingCode
      ? await supabase.from('subscription_plans').update(values).eq('plan_code', editingCode)
      : await supabase.from('subscription_plans').insert(values);
    setSaving(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setMessage('Plan saved. Paid subscriptions still require a verified payment webhook.');
    setDraft(emptyPlan);
    setEditingCode(null);
    await loadPlans();
  }

  async function toggleActive(plan: Plan) {
    if (plan.plan_code === 'free' && plan.is_active) {
      setMessage('The free plan must remain active as a fallback.');
      return;
    }
    const { error } = await supabase.from('subscription_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('plan_code', plan.plan_code);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(plan.is_active ? 'Plan hidden from new subscribers.' : 'Plan is available again.');
    await loadPlans();
  }

  return (
    <div className="space-y-6">
      <div className="border-l-2 border-amber-400 pl-4 text-sm text-gray-400">
        Plan limits are enforced when users claim tasks. Premium activation is intentionally not client-controlled; connect a verified payment-provider webhook before accepting subscriptions.
      </div>
      {message && <div role="status" className="flex items-center justify-between gap-3 border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}<button onClick={() => setMessage('')} aria-label="Dismiss message"><X size={15} /></button></div>}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]">
        <section className="divide-y divide-white/8 border-y border-white/8">
          {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} /> Loading plans</p> : plans.map(plan => (
            <article key={plan.plan_code} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div>
                <div className="flex items-center gap-2"><h2 className="font-bold">{plan.name}</h2><span className={`rounded px-2 py-0.5 text-[11px] ${plan.is_active ? 'bg-green-400/10 text-green-300' : 'bg-white/8 text-gray-400'}`}>{plan.is_active ? 'Available' : 'Hidden'}</span></div>
                <p className="mt-1 text-xs text-gray-400">{plan.plan_code} · {plan.daily_task_limit >= 2147483647 ? 'Unlimited tasks' : `${plan.daily_task_limit} tasks/day`} · {plan.daily_earning_cap === null ? 'No earnings cap' : `₦${Number(plan.daily_earning_cap).toLocaleString()}/day`} · {plan.referral_commission_percent}% referrals</p>
                <p className="mt-1 text-sm font-semibold text-amber-300">{plan.price === 0 ? 'Free' : `₦${plan.price.toLocaleString()} / month`}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => edit(plan)} className="rounded border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">Edit</button>
                {plan.plan_code !== 'free' && <button onClick={() => toggleActive(plan)} className="rounded border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">{plan.is_active ? 'Hide' : 'Publish'}</button>}
              </div>
            </article>
          ))}
          {!loading && plans.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No plans configured.</p>}
        </section>

        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center justify-between"><h2 className="font-bold">{editingCode ? 'Edit plan' : 'Add plan'}</h2>{editingCode && <button type="button" onClick={() => { setEditingCode(null); setDraft(emptyPlan); }} aria-label="Cancel editing" className="text-gray-400 hover:text-white"><X size={16} /></button>}</div>
          <label className="block text-xs text-gray-400">Plan code<input required disabled={!!editingCode} pattern="[a-z0-9_-]{1,40}" value={draft.plan_code} onChange={event => setDraft({ ...draft, plan_code: event.target.value })} placeholder="premium_plus" className="admin-input mt-1" /></label>
          <label className="block text-xs text-gray-400">Display name<input required maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className="admin-input mt-1" /></label>
          <label className="block text-xs text-gray-400">Monthly price (NGN)<input required type="number" min="0" step="0.01" value={draft.price} onChange={event => setDraft({ ...draft, price: Number(event.target.value) })} className="admin-input mt-1" /></label>
          <label className="block text-xs text-gray-400">Daily task limit<input required type="number" min="1" max="2147483647" step="1" value={draft.daily_task_limit} onChange={event => setDraft({ ...draft, daily_task_limit: Number(event.target.value) })} className="admin-input mt-1" /></label>
          <label className="block text-xs text-gray-400">Daily earnings cap (NGN, blank = none)<input type="number" min="0" step="100" value={draft.daily_earning_cap ?? ''} onChange={event => setDraft({ ...draft, daily_earning_cap: event.target.value === '' ? null : Number(event.target.value) })} className="admin-input mt-1" /></label>
          <label className="block text-xs text-gray-400">Referral commission (%)<input required type="number" min="0" max="100" step="0.01" value={draft.referral_commission_percent} onChange={event => setDraft({ ...draft, referral_commission_percent: Number(event.target.value) })} className="admin-input mt-1" /></label>
          <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : editingCode ? <Check size={15} /> : <Plus size={15} />}{editingCode ? 'Save plan' : 'Create plan'}</button>
        </form>
      </div>
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}`}</style>
    </div>
  );
}
