import { useEffect, useState } from 'react';
import { Copy, CheckCircle, Users, Gift, TrendingUp, Share2, ExternalLink, UserRound, Loader2 } from 'lucide-react';
import type { Profile, Balance, Referral } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { useSiteContent } from '@/hooks/useSiteContent';

const referralStepKeys = [
  'referrals.how_it_works.1',
  'referrals.how_it_works.2',
  'referrals.how_it_works.3',
  'referrals.how_it_works.4',
];

const defaultReferralSteps = [
  'Copy and share your unique referral link via WhatsApp, social media, or anywhere.',
  'Your friend signs up using your link and creates a verified account.',
  'When they complete their first hustle, you receive the configured referral bonus.',
  'You continue earning referral rewards as your invite completes hustles.',
];

type ReferredProfile = {
  referred_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  tier: string;
  joined_at: string;
  referral_created_at: string;
  bonus_paid: boolean;
};

interface Props {
  profile: Profile | null;
  balance: Balance | null;
  referrals: Referral[];
  isPremium: boolean;
  allowCustomReferralCode: boolean;
  onProfileUpdated: (profile: Profile) => void;
  onBalanceUpdated: (balance: Balance) => void;
}

export default function ReferralPanel({ profile, balance, referrals, isPremium, allowCustomReferralCode, onProfileUpdated, onBalanceUpdated }: Props) {
  const referralCopy = useSiteContent(referralStepKeys);
  const [copied, setCopied] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [message, setMessage] = useState('');
  const [customCode, setCustomCode] = useState(profile?.referral_code ?? '');
  const [savingCode, setSavingCode] = useState(false);
  const [referredProfiles, setReferredProfiles] = useState<ReferredProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState('');
  const code = profile?.referral_code ?? 'XXXXXX';
  const link = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;

  function copyLink() {
    navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const paidCount   = referrals.filter(r => r.bonus_paid).length;
  const totalReferrals = referrals.length;
  const referredProfilesById = new Map(referredProfiles.map(referred => [referred.referred_id, referred]));

  useEffect(() => {
    let active = true;
    setLoadingProfiles(true);
    supabase.rpc('get_my_referral_profiles').then(({ data, error }) => {
      if (!active) return;
      setLoadingProfiles(false);
      if (error) {
        setProfileLoadError(error.message);
        return;
      }
      setProfileLoadError('');
      setReferredProfiles((data ?? []) as ReferredProfile[]);
    });
    return () => { active = false; };
  }, [profile?.user_id, referrals.length]);

  async function saveCustomCode(event: React.FormEvent) {
    event.preventDefault();
    setSavingCode(true);
    const { data, error } = await supabase.rpc('set_custom_referral_code', { p_code: customCode });
    setSavingCode(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (profile) onProfileUpdated({ ...profile, referral_code: String(data) });
    setCustomCode(String(data));
    setMessage('Custom referral code saved.');
  }

  async function transferReferralEarnings() {
    setTransferring(true);
    setMessage('');
    const { data, error } = await supabase.rpc('transfer_referral_balance');
    setTransferring(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    onBalanceUpdated(data as Balance);
    setMessage('Referral earnings transferred to your Hustler Wallet.');
  }

  const tiers = [
    { level: 'Bronze',   min: 1,  max: 4,  label: '1–4 referrals',  color: 'from-amber-700 to-amber-600', badge: 'border-amber-700/30' },
    { level: 'Silver',   min: 5,  max: 19, label: '5–19 referrals', color: 'from-gray-400 to-gray-300',   badge: 'border-gray-400/30' },
    { level: 'Gold',     min: 20, max: 49, label: '20–49 referrals',color: 'from-amber-400 to-yellow-300',badge: 'border-amber-400/30', hot: true },
    { level: 'Platinum', min: 50, max: 999,label: '50+ referrals',  color: 'from-blue-400 to-cyan-300',   badge: 'border-blue-400/30' },
  ];

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        {[
          { label: 'Total Referrals', value: totalReferrals, icon: Users, color: 'text-amber-400 bg-amber-400/10' },
          { label: 'Bonuses Paid',    value: paidCount,      icon: Gift,  color: 'text-green-400 bg-green-400/10' },
          { label: 'Ref. Balance',    value: `₦${(balance?.referral_balance ?? 0).toLocaleString()}`, icon: TrendingUp, color: 'text-blue-400 bg-blue-400/10' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="min-w-0 bg-[#111] border border-white/5 rounded-2xl p-3 sm:p-4">
              <div className={`w-9 h-9 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                <Icon size={17} />
              </div>
              <p className="break-words text-white font-black text-lg sm:text-xl">{s.value}</p>
              <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
            </div>
          );
        })}
      </div>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-white/8 bg-[#111]">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-5">
          <div><h2 className="text-sm font-bold text-white">People you referred</h2><p className="mt-0.5 text-xs text-gray-500">{totalReferrals} registered {totalReferrals === 1 ? 'person' : 'people'}</p></div>
          <Users size={17} className="shrink-0 text-amber-400" />
        </div>
        {loadingProfiles ? <p className="px-4 py-6 text-center text-xs text-gray-500"><Loader2 size={14} className="mr-1 inline animate-spin" />Loading referred profiles</p>
          : profileLoadError ? <p role="alert" className="px-4 py-4 text-xs text-red-300">Could not load referred profiles: {profileLoadError}</p>
            : referrals.length === 0 ? <p className="px-4 py-6 text-center text-xs text-gray-500">Your referred members will appear here after they register.</p>
              : <ul className="divide-y divide-white/8">{referrals.map(referral => {
                const referred = referredProfilesById.get(referral.referred_id);
                return <li key={referral.id} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5 text-gray-400">{referred?.avatar_url ? <img src={referred.avatar_url} alt="" className="h-full w-full object-cover" /> : <UserRound size={18} />}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-white">{referred?.full_name || referred?.username || 'Member profile unavailable'}</p><p className="truncate text-[10px] text-gray-500">{referred?.username ? `@${referred.username}` : referral.referred_id} · {referred?.tier || 'Member'}</p></div>
                  <div className="shrink-0 text-right"><p className={referral.bonus_paid ? 'text-[10px] font-semibold text-emerald-400' : 'text-[10px] font-semibold text-amber-300'}>{referral.bonus_paid ? 'Bonus paid' : 'Bonus pending'}</p><time className="mt-1 block text-[10px] text-gray-500">{new Date(referred?.referral_created_at ?? referral.created_at).toLocaleDateString('en-NG')}</time></div>
                </li>;
              })}</ul>}
      </section>
      <button onClick={transferReferralEarnings} disabled={transferring || (balance?.referral_balance ?? 0) <= 0} className="flex w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-blue-400/25 bg-blue-400/10 px-3 py-3 text-center text-xs font-bold text-blue-300 hover:bg-blue-400/15 disabled:opacity-50 sm:px-4 sm:text-sm"><TrendingUp size={15} className="shrink-0" />{transferring ? 'Transferring...' : 'Transfer referral earnings to main balance'}</button>
      {message && <p role="status" className="text-center text-xs text-blue-300">{message}</p>}

      {/* Referral link card */}
      <div className="min-w-0 bg-[#111] border border-amber-400/12 rounded-2xl p-4 sm:p-6">
        <div className="mb-4 flex items-start gap-3 sm:items-center">
          <div className="w-9 h-9 rounded-xl bg-amber-400/10 flex items-center justify-center">
            <Share2 size={16} className="text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm">Your Referral Link</p>
            <p className="break-words text-gray-400 text-xs">Share this link to earn for verified signups and completed hustles</p>
          </div>
        </div>

        {/* Link box */}
        <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row">
          <div className="min-w-0 w-full break-all bg-[#0a0a0a] border border-white/5 rounded-xl px-3 py-3 text-xs text-gray-300 font-mono sm:flex-1 sm:px-4 sm:text-sm sm:truncate">
            {link}
          </div>
          <button
            onClick={copyLink}
            className={`flex w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all sm:w-auto ${
              copied
                ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                : 'bg-amber-400/10 hover:bg-amber-400/20 text-amber-400 border border-amber-400/20'
            }`}
          >
            {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Your code */}
        <div className="mb-5 flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 bg-[#0a0a0a] border border-white/5 rounded-xl px-3 py-2.5 sm:px-4">
            <span className="text-gray-400 text-xs">Referral Code</span>
            <span className="break-all text-right text-white font-black text-sm tracking-widest">{code}</span>
          </div>
        </div>

        {isPremium && allowCustomReferralCode && <form onSubmit={saveCustomCode} className="mb-5 flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs text-gray-400">Custom referral code<input required minLength={4} maxLength={16} pattern="[A-Za-z0-9]{4,16}" value={customCode} onChange={event => setCustomCode(event.target.value)} className="mt-1 w-full min-w-0 border border-white/8 bg-[#0a0a0a] px-3 py-2 text-sm text-white" /></label><button disabled={savingCode} className="w-full border border-orange-300/30 px-3 py-2.5 text-xs font-bold text-orange-200 disabled:opacity-50 sm:w-auto">{savingCode ? 'Saving…' : 'Save code'}</button></form>}

        {/* Share buttons */}
        <p className="text-gray-500 text-xs mb-2">Share via:</p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {['WhatsApp', 'Facebook', 'Twitter/X', 'Telegram'].map(ch => (
            <button
              key={ch}
              className="flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-xl border border-white/8 px-2 py-2.5 text-center text-xs font-semibold text-gray-400 transition-all hover:text-white hover:border-white/15 hover:bg-white/5"
            >
              <ExternalLink size={11} />
              {ch.split('/')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* How it works steps */}
      <div className="min-w-0 bg-[#111] border border-white/6 rounded-2xl p-4 sm:p-6">
        <h3 className="text-white font-bold text-sm mb-4">How Referrals Work</h3>
        <div className="space-y-4">
          {defaultReferralSteps.map((fallback, index) => {
            const step = String(index + 1);
            const text = referralCopy[referralStepKeys[index]] || fallback;
            return (
            <div key={step} className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-amber-400/15 border border-amber-400/25 flex items-center justify-center flex-shrink-0">
                <span className="text-amber-400 text-xs font-black">{step}</span>
              </div>
              <p className="min-w-0 break-words text-gray-400 text-sm leading-relaxed pt-0.5">{text}</p>
            </div>
            );
          })}
        </div>
      </div>

      {/* Tier table */}
      <div className="min-w-0 overflow-hidden bg-[#111] border border-white/6 rounded-2xl">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-bold text-sm">Referral Reward Tiers</h3>
        </div>
        <div className="divide-y divide-white/4">
          {tiers.map(tier => {
            const active = totalReferrals >= tier.min && totalReferrals <= tier.max;
            return (
              <div
                key={tier.level}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors sm:px-5 ${
                  active ? 'bg-amber-400/4' : 'hover:bg-white/2'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {active && <CheckCircle size={14} className="text-green-400 flex-shrink-0" />}
                  <div>
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-black bg-gradient-to-r ${tier.color} text-black mb-1`}>
                      {tier.level}
                    </span>
                    <p className="text-gray-400 text-xs">{tier.label}</p>
                  </div>
                </div>
                {active && (
                  <span className="text-green-400 text-xs font-bold bg-green-400/10 border border-green-400/20 px-2.5 py-1 rounded-full">
                    Current
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
