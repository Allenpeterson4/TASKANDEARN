import { useState } from 'react';
import { CreditCard, Clock, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import type { Balance, Withdrawal } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

interface Props {
  balance: Balance | null;
  withdrawals: Withdrawal[];
  userId: string;
  onWithdrawalAdded: (w: Withdrawal) => void;
}

const banks = [
  'Access Bank', 'GTBank', 'First Bank', 'Zenith Bank', 'UBA', 'Sterling Bank',
  'Polaris Bank', 'Fidelity Bank', 'FCMB', 'Union Bank', 'Stanbic IBTC',
  'Kuda Bank', 'Opay', 'Palmpay', 'Moniepoint', 'VFD Bank', 'Rubies MFB',
];

export default function WithdrawalPanel({ balance, withdrawals, userId, onWithdrawalAdded }: Props) {
  const [form, setForm] = useState({ amount: '', bank: '', accountNo: '', accountName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const totalAvailable = (balance?.reward_balance ?? 0) + (balance?.referral_balance ?? 0);

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) return setError('Enter a valid amount.');
    if (amt > totalAvailable) return setError('Insufficient balance for this withdrawal.');
    if (amt < 500) return setError('Minimum withdrawal is ₦500.');

    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('withdrawals')
        .insert({
          user_id: userId,
          amount: amt,
          bank_name: form.bank,
          account_no: form.accountNo,
          account_name: form.accountName,
          status: 'pending',
        })
        .select()
        .single();
      if (err) throw err;
      onWithdrawalAdded(data as Withdrawal);
      setSuccess('Withdrawal request submitted! Processing within 2–24 hours.');
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
        <p className="text-gray-400 text-xs mb-1">Total Available Balance</p>
        <p className="text-white text-3xl font-black mb-1">
          ₦{totalAvailable.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
        </p>
        <p className="text-gray-500 text-xs">
          Reward: ₦{(balance?.reward_balance ?? 0).toLocaleString()} · Referral: ₦{(balance?.referral_balance ?? 0).toLocaleString()}
        </p>
      </div>

      {/* Withdrawal form */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-blue-400/10 flex items-center justify-center">
            <CreditCard size={16} className="text-blue-400" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">Request Withdrawal</p>
            <p className="text-gray-400 text-xs">Minimum ₦500 · Processed within 2–24 hrs</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Amount (₦)</label>
            <input
              type="number"
              required
              min={500}
              max={totalAvailable}
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
            disabled={loading || totalAvailable < 500}
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
