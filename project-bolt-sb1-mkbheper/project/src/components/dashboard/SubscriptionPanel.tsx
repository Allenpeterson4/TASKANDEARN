import { useCallback, useEffect, useState } from 'react';
import { Check, Crown, Loader2, RefreshCw, ShieldCheck, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Plan = {
  plan_code: string;
  name: string;
  price: number;
  currency: string;
  daily_task_limit: number;
  daily_earning_cap: number | null;
  referral_commission_percent: number;
  description: string;
  is_active: boolean;
};

type Subscription = {
  plan_code: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
};

export default function SubscriptionPanel({ userId, onSelectPlan }: { userId: string; onSelectPlan: (planCode: string) => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadPlans = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [planResult, subscriptionResult] = await Promise.all([
      supabase.from('subscription_plans').select('*').eq('is_active', true).order('price'),
      supabase.from('user_subscriptions')
        .select('plan_code, status, starts_at, ends_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const error = planResult.error ?? subscriptionResult.error;
    if (error) setMessage(error.message);
    setPlans((planResult.data ?? []) as Plan[]);
    setSubscription(subscriptionResult.data as Subscription | null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    loadPlans();
    const refreshOnFocus = () => { void loadPlans(true); };
    const timer = window.setInterval(() => { void loadPlans(true); }, 30000);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [loadPlans]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-amber-400">Membership</p><h2 className="mt-1 text-xl font-black text-white">Plans and task limits</h2></div>
        <button onClick={() => loadPlans()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-50"><RefreshCw size={14} /> Refresh status</button>
      </div>

      {subscription && (
        <div className="flex items-start gap-3 border border-green-400/20 bg-green-400/5 p-4">
          <ShieldCheck size={18} className="mt-0.5 text-green-300" />
          <div><p className="font-semibold text-white">{plans.find(plan => plan.plan_code === subscription.plan_code)?.name ?? subscription.plan_code} active</p><p className="mt-1 text-xs text-gray-400">Expires {subscription.ends_at ? new Date(subscription.ends_at).toLocaleDateString('en-NG') : 'on provider schedule'}.</p></div>
        </div>
      )}

      {message && <div role="status" className="border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">{message}</div>}
      {loading ? <div className="flex min-h-40 items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin" size={17} /> Loading plans</div> : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map(plan => {
            const current = plan.plan_code === (subscription?.plan_code ?? 'free');
            return (
              <article key={plan.plan_code} className={`flex flex-col border p-5 ${current ? 'border-amber-400/40 bg-amber-400/5' : 'border-white/10 bg-[#111]'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="text-lg font-bold text-white">{plan.name}</h3><p className="mt-1 text-xs text-gray-400">{plan.daily_task_limit >= 2147483647 ? 'Unlimited tasks' : `${plan.daily_task_limit} tasks per day`}</p></div>
                  {plan.plan_code === 'vip' ? <Crown size={18} className="text-amber-400" /> : null}
                </div>
                <p className="mt-5 text-2xl font-black text-white">{plan.price === 0 ? 'Free' : `₦${plan.price.toLocaleString()} / month`}</p>
                <p className="mt-2 text-sm text-gray-400">{plan.description || 'More earning access, higher limits, and better rewards.'}</p>
                <p className="mt-2 text-sm text-gray-400">{plan.daily_earning_cap === null ? 'No daily earning cap' : `Up to ₦${Number(plan.daily_earning_cap).toLocaleString()} per day`}</p>
                <p className="mt-1 text-sm text-gray-400">{plan.referral_commission_percent}% referral commission</p>
                <div className="my-5 flex-1 border-t border-white/8 pt-4 text-xs text-gray-400"><Check size={14} className="mr-2 inline text-green-400" />Limits are enforced on the server</div>
                {current ? (
                  <button disabled className="w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm text-gray-400">Current plan</button>
                ) : plan.price > 0 ? (
                  <button onClick={() => onSelectPlan(plan.plan_code)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2.5 text-sm font-bold text-black">
                    <ArrowRight size={15} /> Upgrade to {plan.name}
                  </button>
                ) : null}
              </article>
            );
          })}
          {plans.length === 0 && <p className="col-span-full py-10 text-center text-sm text-gray-500">Plans are unavailable. Try refreshing.</p>}
        </div>
      )}
      <p className="text-xs text-gray-500">Upgrades are paid from your selected reward and/or referral wallet balances. Your plan activates immediately after successful debit.</p>

    </div>
  );
}
