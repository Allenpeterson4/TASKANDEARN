import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type PayoutSettings = {
  minimum_amount: number;
  enabled: boolean;
};

const defaultSettings: PayoutSettings = {
  minimum_amount: 500,
  enabled: false,
};

export default function AdminPayoutSettingsPanel() {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('payout_settings').select('minimum_amount, enabled').eq('singleton', true).maybeSingle().then(({ data, error }) => {
      if (error) setMessage(error.message);
      if (data) {
        setSettings({
          minimum_amount: Number(data.minimum_amount),
          enabled: data.enabled,
        });
      }
      setLoading(false);
    });
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('payout_settings').update({
      ...settings,
      updated_at: new Date().toISOString(),
      updated_by: (await supabase.auth.getUser()).data.user?.id,
    }).eq('singleton', true);
    setSaving(false);
    setMessage(error ? error.message : 'Payout settings saved. Requests can be queued before the processing window.');
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3 border-l-2 border-amber-400 pl-4 text-sm text-gray-400">
        <CalendarClock size={17} className="mt-0.5 shrink-0 text-amber-300" />
        <p>This is the global minimum and master switch. Set separate wallet payout days and times in Platform Controls. Payout processing still requires an admin review.</p>
      </div>
      {message && <div role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</div>}
      {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} /> Loading payout settings</p> : (
        <>
          <label className="block max-w-sm text-xs text-gray-400">Minimum withdrawal (NGN)
            <input required type="number" min="500" step="500" value={settings.minimum_amount} onChange={event => setSettings({ ...settings, minimum_amount: Number(event.target.value) })} className="admin-input mt-1" />
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-300"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} className="accent-amber-400" /> Enable withdrawal requests for both wallets</label>
          <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save payout settings</button>
        </>
      )}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}`}</style>
    </form>
  );
}
