import { useEffect, useState } from 'react';
import { Gift, Loader2, X } from 'lucide-react';
import type { Balance } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

type SocialLink = { label: string; url: string };
type Announcement = { title: string; message: string; enabled: boolean; welcome_bonus: number; require_social: boolean; social_links: SocialLink[] };

interface Props {
  userId: string;
  fullName?: string;
  onClose: () => void;
  onClaimOffer: () => void;
  onBalanceUpdated: (balance: Balance) => void;
}

export default function AnnouncementModal({ userId, fullName, onClose, onClaimOffer, onBalanceUpdated }: Props) {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [openedLinks, setOpenedLinks] = useState<number[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      const [{ data: config }, { data: claim }] = await Promise.all([
        supabase.from('platform_announcements').select('title, message, enabled, welcome_bonus, require_social, social_links').eq('singleton', true).maybeSingle(),
        supabase.from('welcome_bonus_claims').select('user_id').eq('user_id', userId).maybeSingle(),
      ]);
      if (!active) return;
      if (config?.enabled) setAnnouncement(config as Announcement);
      setClaimed(!!claim);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [userId]);

  async function claimBonus() {
    if (!announcement) return;
    setClaiming(true);
    setMessage('');
    const socialConfirmed = announcement.require_social && confirmed && openedLinks.length === announcement.social_links.length;
    const { data, error } = await supabase.rpc('claim_welcome_bonus', { p_social_confirmed: socialConfirmed });
    if (error) {
      setMessage(error.message);
      setClaiming(false);
      return;
    }
    const { data: balance } = await supabase.from('balances').select('*').eq('user_id', userId).maybeSingle();
    if (balance) onBalanceUpdated(balance as Balance);
    setClaimed(true);
    setMessage(`Welcome bonus of ₦${Number(data).toLocaleString()} added to your Hustler Wallet.`);
    setClaiming(false);
  }

  if (loading || !announcement) return null;
  const canClaim = announcement.welcome_bonus > 0 && !claimed && (!announcement.require_social || (confirmed && openedLinks.length === announcement.social_links.length));

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Platform announcement" className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-orange-300/20 bg-[#111] shadow-2xl">
        <div className="h-1 bg-gradient-to-r from-orange-300 to-amber-500" />
        <header className="flex items-start justify-between gap-4 p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center bg-orange-300/10 text-orange-200"><Gift size={19} /></span><div><p className="text-[10px] font-bold uppercase text-orange-200">Mr Hustle update</p><h2 className="mt-1 text-lg font-black text-white">{announcement.title}</h2><p className="mt-1 text-xs text-gray-500">{fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi, Hustler'}</p></div></div><button onClick={onClose} aria-label="Close announcement" className="p-2 text-gray-400 hover:text-white"><X size={17} /></button></header>
        {announcement.message && <p className="whitespace-pre-wrap px-5 pb-4 text-sm leading-relaxed text-gray-300 sm:px-6">{announcement.message}</p>}
        {announcement.require_social && announcement.social_links.length > 0 && <section className="mx-5 border-y border-white/8 py-4 sm:mx-6"><h3 className="text-sm font-bold text-white">Official channels</h3><div className="mt-3 flex flex-wrap gap-2">{announcement.social_links.map((link, index) => <a key={`${link.label}-${index}`} href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpenedLinks(current => current.includes(index) ? current : [...current, index])} className={`border px-3 py-2 text-xs font-semibold ${openedLinks.includes(index) ? 'border-orange-300/40 text-orange-200' : 'border-white/10 text-gray-300 hover:border-white/20'}`}>{openedLinks.includes(index) ? 'Opened: ' : ''}{link.label}</a>)}</div><label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-gray-400"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 accent-orange-400" />I have joined the official channels listed above.</label></section>}
        {announcement.welcome_bonus > 0 && <div className="px-5 py-4 sm:px-6"><p className="text-sm text-gray-300">Welcome reward <strong className="text-orange-200">₦{Number(announcement.welcome_bonus).toLocaleString()}</strong></p>{claimed && <p className="mt-2 text-xs text-orange-200">Your welcome bonus has already been claimed.</p>}</div>}
        {message && <p role="status" className="mx-5 border border-orange-300/20 bg-orange-300/5 px-3 py-2 text-xs text-orange-100 sm:mx-6">{message}</p>}
        <footer className="flex flex-wrap justify-end gap-2 p-5 sm:px-6"><button onClick={onClose} className="border border-white/10 px-4 py-2.5 text-sm font-semibold text-gray-300 hover:bg-white/5">Close</button>{!claimed && announcement.welcome_bonus > 0 ? <button onClick={() => void claimBonus()} disabled={!canClaim || claiming} className="flex items-center gap-2 bg-orange-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-40">{claiming && <Loader2 className="animate-spin" size={15} />}Claim welcome bonus</button> : <button onClick={onClaimOffer} className="bg-orange-400 px-4 py-2.5 text-sm font-bold text-black">Explore hustles</button>}</footer>
      </section>
    </div>
  );
}
