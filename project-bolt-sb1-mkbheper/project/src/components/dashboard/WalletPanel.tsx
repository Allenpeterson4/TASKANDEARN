import { useState } from 'react';
import { CircleDollarSign, Users, WalletCards } from 'lucide-react';
import type { Balance, Profile, Referral, Withdrawal } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import FundAccountPanel from './FundAccountPanel';
import ReferralPanel from './ReferralPanel';
import WithdrawalPanel from './WithdrawalPanel';

type WalletSection = 'hustler' | 'referral' | 'fund';

interface Props {
  profile: Profile | null;
  balance: Balance | null;
  referrals: Referral[];
  withdrawals: Withdrawal[];
  userId: string;
  currentPlanCode: string;
  allowTransfers: boolean;
  allowCustomReferralCode: boolean;
  onWithdrawalAdded: (withdrawal: Withdrawal) => void;
  onBalanceUpdated: (balance: Balance) => void;
  onProfileUpdated: (profile: Profile) => void;
}

const sections: { id: WalletSection; label: string; icon: typeof WalletCards }[] = [
  { id: 'hustler', label: 'Hustler Wallet', icon: WalletCards },
  { id: 'referral', label: 'Referral Wallet', icon: Users },
  { id: 'fund', label: 'Fund Wallet', icon: CircleDollarSign },
];

export default function WalletPanel({ profile, balance, referrals, withdrawals, userId, currentPlanCode, allowTransfers, allowCustomReferralCode, onWithdrawalAdded, onBalanceUpdated, onProfileUpdated }: Props) {
  const [active, setActive] = useState<WalletSection>('hustler');
  const [recipient, setRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferMessage, setTransferMessage] = useState('');
  const [transferring, setTransferring] = useState(false);

  async function transferEarnings(event: React.FormEvent) {
    event.preventDefault();
    setTransferring(true);
    setTransferMessage('');
    const { data, error } = await supabase.rpc('transfer_earnings_to_user', {
      p_recipient: recipient.trim(),
      p_amount: Number(transferAmount),
    });
    setTransferring(false);
    if (error) {
      setTransferMessage(error.message);
      return;
    }
    onBalanceUpdated(data as Balance);
    setRecipient('');
    setTransferAmount('');
    setTransferMessage('Earnings transferred successfully.');
  }

  return (
    <div className="space-y-6">
      <nav className="grid grid-cols-3 border-b border-white/10" aria-label="Wallet sections">
        {sections.map(section => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              aria-pressed={active === section.id}
              onClick={() => setActive(section.id)}
              className={`flex items-center justify-center gap-2 border-b-2 px-2 py-3 text-xs font-semibold transition-colors sm:text-sm ${active === section.id ? 'border-amber-400 text-amber-300' : 'border-transparent text-gray-400 hover:text-white'}`}
            >
              <Icon size={16} /> {section.label}
            </button>
          );
        })}
      </nav>

      {active === 'hustler' && <div className="space-y-6"><WithdrawalPanel walletType="hustler" balance={balance} withdrawals={withdrawals} onWithdrawalAdded={onWithdrawalAdded} />{currentPlanCode !== 'free' && allowTransfers && <form onSubmit={transferEarnings} className="max-w-2xl space-y-4 border-t border-white/10 pt-5"><div><h2 className="font-bold text-white">Transfer earnings</h2><p className="mt-1 text-xs text-gray-400">Send your available Hustler Wallet balance to any active hustler by username or referral code.</p></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-gray-400">Recipient<input required value={recipient} onChange={event => setRecipient(event.target.value)} className="mt-1 w-full border border-white/10 bg-[#0a0a0a] px-3 py-2.5 text-sm text-white" placeholder="Username or referral code" /></label><label className="text-xs text-gray-400">Amount (NGN)<input required type="number" min="0.01" step="0.01" max={balance?.reward_balance ?? 0} value={transferAmount} onChange={event => setTransferAmount(event.target.value)} className="mt-1 w-full border border-white/10 bg-[#0a0a0a] px-3 py-2.5 text-sm text-white" /></label></div><button disabled={transferring} className="bg-orange-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{transferring ? 'Transferring…' : 'Transfer earnings'}</button>{transferMessage && <p role="status" className="text-xs text-orange-200">{transferMessage}</p>}</form>}</div>}
      {active === 'referral' && <div className="space-y-6"><ReferralPanel profile={profile} balance={balance} referrals={referrals} isPremium={currentPlanCode !== 'free'} allowCustomReferralCode={allowCustomReferralCode} onProfileUpdated={onProfileUpdated} onBalanceUpdated={onBalanceUpdated} /><WithdrawalPanel walletType="referral" balance={balance} withdrawals={withdrawals} onWithdrawalAdded={onWithdrawalAdded} /></div>}
      {active === 'fund' && <FundAccountPanel userId={userId} />}
    </div>
  );
}
