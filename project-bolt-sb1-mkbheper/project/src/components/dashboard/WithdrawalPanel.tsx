import { useEffect, useState } from 'react';
import { CreditCard, Clock, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import type { Balance, Withdrawal } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

interface Props {
  walletType: 'hustler' | 'referral';
  balance: Balance | null;
  withdrawals: Withdrawal[];
  onWithdrawalAdded: (w: Withdrawal) => void;
}

const banks = [
  'Access Bank', 'GTBank', 'First Bank', 'Zenith Bank', 'UBA', 'Sterling Bank',
  'Polaris Bank', 'Fidelity Bank', 'FCMB', 'Union Bank', 'Stanbic IBTC',
  'Kuda Bank', 'Opay', 'Palmpay', 'Moniepoint', 'VFD Bank', 'Rubies MFB',
];
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function WithdrawalPanel({ walletType, balance, withdrawals, onWithdrawalAdded }: Props) {
  const [form, setForm] = useState({ amount: '', bank: '', accountNo: '', accountName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [minimumWithdrawal, setMinimumWithdrawal] = useState(500);
  const [maximumWithdrawal, setMaximumWithdrawal] = useState(500);
  const [walletWithdrawalsEnabled, setWalletWithdrawalsEnabled] = useState(true);
  const [requirementMessage, setRequirementMessage] = useState('Your account has not met the withdrawal requirements yet.');
  const [payoutWindow, setPayoutWindow] = useState({ days: [5], start: '14:00', end: '18:00', timezone: 'Africa/Lagos', enabled: false });

  const totalAvailable = walletType === 'hustler' ? (balance?.reward_balance ?? 0) : (balance?.referral_balance ?? 0);
  const walletLabel = walletType === 'hustler' ? 'Hustler Wallet' : 'Referral Wallet';

  useEffect(() => {
    let active = true;
    async function loadSettings() {
      const [{ data: payout }, { data: controls }, { data: subscription }] = await Promise.all([
        supabase.from('payout_settings').select('minimum_amount, payout_days, window_start, window_end, timezone, enabled').eq('singleton', true).maybeSingle(),
        supabase.from('platform_settings').select('hustler_withdrawals_enabled, referral_withdrawals_enabled, withdrawal_failure_message, hustler_payout_days, hustler_window_start, hustler_window_end, hustler_timezone, referral_payout_days, referral_window_start, referral_window_end, referral_timezone').eq('singleton', true).maybeSingle(),
        supabase.from('user_subscriptions').select('plan_code').eq('user_id', balance?.user_id ?? '').eq('status', 'active').or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).order('starts_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!active) return;
      if (payout) {
        setMinimumWithdrawal(Number(payout.minimum_amount));
        setPayoutWindow(current => ({ ...current, enabled: payout.enabled }));
      }
      if (controls) {
        setWalletWithdrawalsEnabled(walletType === 'hustler' ? controls.hustler_withdrawals_enabled : controls.referral_withdrawals_enabled);
        setRequirementMessage(controls.withdrawal_failure_message);
        setPayoutWindow(current => ({
          ...current,
          days: walletType === 'hustler' ? controls.hustler_payout_days : controls.referral_payout_days,
          start: String(walletType === 'hustler' ? controls.hustler_window_start : controls.referral_window_start).slice(0, 5),
          end: String(walletType === 'hustler' ? controls.hustler_window_end : controls.referral_window_end).slice(0, 5),
          timezone: walletType === 'hustler' ? controls.hustler_timezone : controls.referral_timezone,
        }));
      }
      const planCode = subscription?.plan_code ?? 'free';
      const { data: plan } = await supabase.from('subscription_plans').select('max_withdrawal').eq('plan_code', planCode).maybeSingle();
      if (active && plan) setMaximumWithdrawal(Number(plan.max_withdrawal));
    }
    void loadSettings();
    return () => { active = false; };
  }, [balance?.user_id, walletType]);

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!walletWithdrawalsEnabled) return setError(requirementMessage);
    if (!payoutWindow.enabled) {
      setSuccess(`Withdrawals are processed on ${payoutWindow.days.map(day => weekdayNames[day]).join(', ')} between ${payoutWindow.start} and ${payoutWindow.end} (${payoutWindow.timezone}). The next payout window has not been enabled yet. Keep completing hustles and await the next payout window.`);
      return;
    }
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) return setError('Enter a valid amount.');
    if (amt > totalAvailable) return setError('Insufficient balance for this withdrawal.');
    if (amt < minimumWithdrawal) return setError(`Minimum withdrawal is ₦${minimumWithdrawal.toLocaleString()}.`);
    if (amt > maximumWithdrawal) return setError(`${walletLabel} withdrawals are capped at ₦${maximumWithdrawal.toLocaleString()} for your plan.`);

    setLoading(true);
    try {
      const { data, error: err } = await supabase.rpc('request_withdrawal', {
        p_amount: amt,
        p_bank_name: form.bank,
        p_account_no: form.accountNo,
        p_account_name: form.accountName,
        p_wallet_type: walletType,
      });
      if (err) throw err;
      onWithdrawalAdded(data as Withdrawal);
      setSuccess('Withdrawal request queued for the next configured payout window.');
      setForm({ amount: '', bank: '', accountNo: '', accountName: '' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const statusIcon = (s: string) => {
    if (s === 'approved') return <CheckCircle size={14} className="text-green-400" />;
    if (s === 'rejected') return <XCircle size={14} className="text-red-400" />;
    return <Clock size={14} className="text-amber-400" />;
  };
  const statusColor = (s: string) =>
    s === 'approved' ? 'text-green-400' : s === 'rejected' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="space-y-6">
      {/* Available balance */}
      <div className="bg-gradient-to-r from-amber-400/8 to-orange-500/4 border border-amber-400/12 rounded-2xl p-5">
        <p className="text-gray-400 text-xs mb-1">{walletLabel} balance</p>
        <p className="text-white text-3xl font-black mb-1">
          ₦{totalAvailable.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
        </p>
        <p className="text-gray-500 text-xs">Maximum withdrawal ₦{maximumWithdrawal.toLocaleString()} per request</p>
      </div>

      {/* Withdrawal form */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-blue-400/10 flex items-center justify-center">
            <CreditCard size={16} className="text-blue-400" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">Withdraw from {walletLabel}</p>
            <p className="text-gray-400 text-xs">Minimum ₦{minimumWithdrawal.toLocaleString()} · {payoutWindow.days.map(day => weekdayNames[day]).join(', ')} {payoutWindow.start}–{payoutWindow.end} ({payoutWindow.timezone})</p>
          </div>
        </div>
        <div className="mb-5 border border-blue-400/20 bg-blue-400/5 px-4 py-3 text-xs leading-relaxed text-blue-300">Withdrawals are processed only during designated payout windows. {payoutWindow.enabled ? 'The current window is enabled.' : 'The next payout window is awaiting admin enablement.'} Keep completing hustles and await the next payout window.</div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Amount (₦)</label>
            <input
              type="number"
              required
              min={minimumWithdrawal}
              max={Math.min(totalAvailable, maximumWithdrawal)}
              placeholder="e.g. 2000"
              value={form.amount}
              onChange={set('amount')}
              className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
            />
            <div className="flex gap-2 mt-2">
              {[500, 1000, 2000, 5000].map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, amount: String(amt) }))}
                  className="px-2.5 py-1 rounded-lg bg-white/4 hover:bg-amber-400/10 text-gray-400 hover:text-amber-400 text-xs transition-all border border-white/4"
                >
                  ₦{amt.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Bank / Wallet</label>
            <select
              required
              value={form.bank}
              onChange={set('bank')}
              className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-400/50 transition-colors"
            >
              <option value="">Select your bank</option>
              {banks.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Account Number</label>
            <input
              type="text"
              required
              pattern="\d{10}"
              maxLength={10}
              placeholder="0123456789"
              value={form.accountNo}
              onChange={set('accountNo')}
              className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Account Name</label>
            <input
              type="text"
              required
              placeholder="As on your bank account"
              value={form.accountName}
              onChange={set('accountName')}
              className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-green-400 text-sm">
              <CheckCircle size={14} />
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !payoutWindow.enabled || !walletWithdrawalsEnabled || totalAvailable < minimumWithdrawal}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm hover:shadow-xl hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Submit Withdrawal Request'}
          </button>
        </form>
      </div>

      {/* History */}
      <div className="bg-[#111] border border-white/6 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-bold text-sm">Withdrawal History</h3>
        </div>
        {withdrawals.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            <CreditCard size={36} className="mx-auto mb-3 opacity-20" />
            No withdrawal requests yet.
          </div>
        ) : (
          <div className="divide-y divide-white/4">
            {withdrawals.map(w => (
              <div key={w.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
                    {statusIcon(w.status)}
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">{w.bank_name}</p>
                    <p className="text-gray-500 text-xs">{w.account_no} · {new Date(w.requested_at).toLocaleDateString('en-NG')}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-black text-sm">₦{w.amount.toLocaleString()}</p>
                  <p className={`text-xs font-semibold capitalize ${statusColor(w.status)}`}>{w.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
