import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type SocialLink = { label: string; url: string };
type Announcement = { title: string; message: string; enabled: boolean; welcome_bonus: number; require_social: boolean; social_links: SocialLink[] };
const initial: Announcement = { title: 'Welcome to Mr Hustle', message: '', enabled: false, welcome_bonus: 0, require_social: false, social_links: [] };

export default function AdminAnnouncementPanel() {
  const [announcement, setAnnouncement] = useState(initial);
  const [linksText, setLinksText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('platform_announcements').select('*').eq('singleton', true).maybeSingle().then(({ data, error }) => {
      if (error) setMessage(error.message);
      if (data) {
        const loaded = data as Announcement;
        setAnnouncement(loaded);
        setLinksText(loaded.social_links.map(link => `${link.label}|${link.url}`).join('\n'));
      }
      setLoading(false);
    });
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const socialLinks = linksText.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const separator = line.indexOf('|');
      return separator < 0 ? null : { label: line.slice(0, separator).trim(), url: line.slice(separator + 1).trim() };
    });
    if (socialLinks.some(link => !link || !link.label || !/^https:\/\//i.test(link.url))) {
      setMessage('Enter each social link as Label|https://url.');
      return;
    }
    if (announcement.require_social && socialLinks.length === 0) {
      setMessage('Add at least one official social link before requiring social confirmation.');
      return;
    }
    setSaving(true);
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from('platform_announcements').upsert({ singleton: true, ...announcement, social_links: socialLinks, updated_by: user.user?.id, updated_at: new Date().toISOString() });
    setSaving(false);
    setMessage(error ? error.message : 'Announcement settings saved.');
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <div><h2 className="text-lg font-bold">Announcement and welcome popup</h2><p className="mt-1 text-sm text-gray-400">Configure the message shown to signed-in hustlers and an optional one-time welcome reward.</p></div>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}
      {loading ? <p className="py-8 text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading announcement</p> : <>
        <label className="block text-xs text-gray-400">Headline<input required maxLength={120} value={announcement.title} onChange={event => setAnnouncement({ ...announcement, title: event.target.value })} className="admin-input mt-1" /></label>
        <label className="block text-xs text-gray-400">Announcement<textarea maxLength={2000} rows={5} value={announcement.message} onChange={event => setAnnouncement({ ...announcement, message: event.target.value })} className="admin-input mt-1 resize-y" /></label>
        <label className="block max-w-sm text-xs text-gray-400">Welcome bonus (NGN)<input type="number" min="0" step="0.01" value={announcement.welcome_bonus} onChange={event => setAnnouncement({ ...announcement, welcome_bonus: Number(event.target.value) })} className="admin-input mt-1" /></label>
        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={announcement.require_social} onChange={event => setAnnouncement({ ...announcement, require_social: event.target.checked })} className="accent-orange-400" />Require hustlers to confirm joining official channels before claiming</label>
        <label className="block text-xs text-gray-400">Official social links, one per line as Label|https://url<textarea rows={4} value={linksText} onChange={event => setLinksText(event.target.value)} className="admin-input mt-1 resize-y" placeholder={'Instagram|https://instagram.com/your-page\nYouTube|https://youtube.com/@your-channel'} /></label>
        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={announcement.enabled} onChange={event => setAnnouncement({ ...announcement, enabled: event.target.checked })} className="accent-orange-400" />Publish popup</label>
        <button disabled={saving} className="flex items-center gap-2 bg-orange-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}Save announcement</button>
      </>}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,146,60,.55)}`}</style>
    </form>
  );
}
