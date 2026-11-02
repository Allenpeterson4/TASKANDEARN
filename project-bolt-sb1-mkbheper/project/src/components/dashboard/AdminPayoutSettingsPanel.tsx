import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type PayoutSettings = {
  minimum_amount: number;
  payout_days: number[];
  window_start: string;
  window_end: string;
  timezone: string;
};

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const defaultSettings: PayoutSettings = {
  minimum_amount: 5000,
  payout_days: [5],
  window_start: '14:00:00',
  window_end: '18:00:00',
  timezone: 'Africa/Lagos',
};

export default function AdminPayoutSettingsPanel() {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('payout_settings').select('*').eq('singleton', true).maybeSingle().then(({ data, error }) => {
      if (error) setMessage(error.message);
      if (data) {
        setSettings({
          minimum_amount: Number(data.minimum_amount),
          payout_days: data.payout_days,
          window_start: data.window_start,
          window_end: data.window_end,
          timezone: data.timezone,
        });
      }
      setLoading(false);
    });
  }, []);

  function toggleDay(day: number) {
    setSettings(current => ({
      ...current,
      payout_days: current.payout_days.includes(day)
        ? current.payout_days.filter(value => value !== day)
        : [...current.payout_days, day].sort(),
    }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings.payout_days.length) {
      setMessage('Select at least one payout day.');
      return;
    }
    if (settings.window_start >= settings.window_end) {
      setMessage('The payout window end must be later than its start.');
      return;
    }
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
        <p>These settings define when queued requests are scheduled for review. Automatic bank transfers still require a configured payout provider and a server-side scheduler.</p>
      </div>
      {message && <div role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</div>}
      {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} /> Loading payout settings</p> : (
        <>
          <label className="block max-w-sm text-xs text-gray-400">Minimum withdrawal (NGN)
            <input required type="number" min="500" step="500" value={settings.minimum_amount} onChange={event => setSettings({ ...settings, minimum_amount: Number(event.target.value) })} className="admin-input mt-1" />
          </label>
          <fieldset>
            <legend className="mb-2 text-xs text-gray-400">Payout days</legend>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((day, index) => (
                <label key={day} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs ${settings.payout_days.includes(index) ? 'border-amber-300/50 bg-amber-300/10 text-amber-200' : 'border-white/10 text-gray-400'}`}>
                  <input type="checkbox" checked={settings.payout_days.includes(index)} onChange={() => toggleDay(index)} className="sr-only" />{day}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid max-w-lg gap-4 sm:grid-cols-2">
            <label className="text-xs text-gray-400">Window opens<input required type="time" value={settings.window_start.slice(0, 5)} onChange={event => setSettings({ ...settings, window_start: event.target.value })} className="admin-input mt-1" /></label>
            <label className="text-xs text-gray-400">Window closes<input required type="time" value={settings.window_end.slice(0, 5)} onChange={event => setSettings({ ...settings, window_end: event.target.value })} className="admin-input mt-1" /></label>
          </div>
          <label className="block max-w-sm text-xs text-gray-400">Timezone
            <select value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.target.value })} className="admin-input mt-1"><option value="Africa/Lagos">Africa/Lagos (WAT)</option><option value="UTC">UTC</option></select>
          </label>
          <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save payout settings</button>
        </>
      )}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}`}</style>
    </form>
  );
}
