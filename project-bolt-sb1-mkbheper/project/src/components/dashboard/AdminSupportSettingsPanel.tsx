import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const widgetKey = 'support.live_chat.widget_code';

export default function AdminSupportSettingsPanel() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('site_content').select('body').eq('content_key', widgetKey).maybeSingle().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setCode(data?.body ?? '');
      setLoading(false);
    });
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('site_content').upsert({
      content_key: widgetKey,
      title: 'Live Chat Widget Code',
      body: code.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'content_key' });
    setSaving(false);
    setMessage(error ? error.message : 'Live chat widget code saved. Refreshing users will load the provider widget.');
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <div><p className="text-xs font-bold uppercase tracking-wider text-amber-300">Support configuration</p><h2 className="mt-1 text-xl font-black">Live Chat Widget Code</h2><p className="mt-1 text-sm leading-relaxed text-gray-400">Paste the provider’s complete embed code from Tawk.to, Crisp, Intercom, or another trusted provider. The code is rendered for frontend visitors after saving.</p></div>
      <label className="block text-xs text-gray-400">Raw provider embed code<textarea value={code} onChange={event => setCode(event.target.value)} rows={14} spellCheck={false} placeholder="<!-- Paste the provider widget script here -->" className="admin-input mt-1 resize-y font-mono text-xs" /></label>
      <div className="border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-relaxed text-amber-200">Only paste code from a provider you trust. This setting intentionally allows script tags because chat providers need to load their external widget.</div>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}
      <button disabled={saving || loading} className="flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save widget code</button>
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}.admin-input::placeholder{color:#6b7280}`}</style>
    </form>
  );
}
