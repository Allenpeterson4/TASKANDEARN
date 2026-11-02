import { useState } from 'react';
import { Copy, CheckCircle, Users, Gift, TrendingUp, Share2, ExternalLink } from 'lucide-react';
import type { Profile, Balance, Referral } from '@/lib/supabase';

interface Props {
  profile: Profile | null;
  balance: Balance | null;
  referrals: Referral[];
}

export default function ReferralPanel({ profile, balance, referrals }: Props) {
  const [copied, setCopied] = useState(false);
  const code = profile?.referral_code ?? 'XXXXXX';
  const link = `https://mrhustler.ng/ref/${code}`;

  function copyLink() {
    navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const paidCount   = referrals.filter(r => r.bonus_paid).length;
  const totalReferrals = referrals.length;

  const tiers = [
    { level: 'Bronze',   min: 1,  max: 4,  label: '1–4 referrals',  color: 'from-amber-700 to-amber-600', badge: 'border-amber-700/30' },
    { level: 'Silver',   min: 5,  max: 19, label: '5–19 referrals', color: 'from-gray-400 to-gray-300',   badge: 'border-gray-400/30' },
    { level: 'Gold',     min: 20, max: 49, label: '20–49 referrals',color: 'from-amber-400 to-yellow-300',badge: 'border-amber-400/30', hot: true },
    { level: 'Platinum', min: 50, max: 999,label: '50+ referrals',  color: 'from-blue-400 to-cyan-300',   badge: 'border-blue-400/30' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Referrals', value: totalReferrals, icon: Users, color: 'text-amber-400 bg-amber-400/10' },
          { label: 'Bonuses Paid',    value: paidCount,      icon: Gift,  color: 'text-green-400 bg-green-400/10' },
          { label: 'Ref. Balance',    value: `₦${(balance?.referral_balance ?? 0).toLocaleString()}`, icon: TrendingUp, color: 'text-blue-400 bg-blue-400/10' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-[#111] border border-white/5 rounded-2xl p-4">
              <div className={`w-9 h-9 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                <Icon size={17} />
              </div>
              <p className="text-white font-black text-xl">{s.value}</p>
              <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Referral link card */}
      <div className="bg-[#111] border border-amber-400/12 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-amber-400/10 flex items-center justify-center">
            <Share2 size={16} className="text-amber-400" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">Your Referral Link</p>
            <p className="text-gray-400 text-xs">Share this link to earn for every signup</p>
          </div>
        </div>

        {/* Link box */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 bg-[#0a0a0a] border border-white/5 rounded-xl px-4 py-3 text-sm text-gray-300 font-mono truncate">
            {link}
          </div>
          <button
            onClick={copyLink}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all flex-shrink-0 ${
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
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 bg-[#0a0a0a] border border-white/5 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <span className="text-gray-400 text-xs">Referral Code</span>
            <span className="text-white font-black text-sm tracking-widest">{code}</span>
          </div>
        </div>

        {/* Share buttons */}
        <p className="text-gray-500 text-xs mb-2">Share via:</p>
        <div className="grid grid-cols-4 gap-2">
          {['WhatsApp', 'Facebook', 'Twitter/X', 'Telegram'].map(ch => (
            <button
              key={ch}
              className="py-2.5 rounded-xl border border-white/8 text-gray-400 hover:text-white hover:border-white/15 hover:bg-white/5 text-xs font-semibold transition-all flex items-center justify-center gap-1"
            >
              <ExternalLink size={11} />
              {ch.split('/')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* How it works steps */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-6">
        <h3 className="text-white font-bold text-sm mb-4">How Referrals Work</h3>
        <div className="space-y-4">
          {[
            { step: '1', text: 'Copy and share your unique referral link via WhatsApp, social media, or anywhere.' },
            { step: '2', text: 'Your friend signs up using your link and creates a verified account.' },
            { step: '3', text: 'When they complete their first task, you both receive a welcome bonus.' },
            { step: '4', text: 'You continue earning a percentage every time your referral completes tasks.' },
          ].map(s => (
            <div key={s.step} className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-amber-400/15 border border-amber-400/25 flex items-center justify-center flex-shrink-0">
                <span className="text-amber-400 text-xs font-black">{s.step}</span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed pt-0.5">{s.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tier table */}
      <div className="bg-[#111] border border-white/6 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-bold text-sm">Referral Reward Tiers</h3>
        </div>
        <div className="divide-y divide-white/4">
          {tiers.map(tier => {
            const active = totalReferrals >= tier.min && totalReferrals <= tier.max;
            return (
              <div
                key={tier.level}
                className={`flex items-center justify-between px-5 py-3.5 transition-colors ${
                  active ? 'bg-amber-400/4' : 'hover:bg-white/2'
                }`}
              >
                <div className="flex items-center gap-3">
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
