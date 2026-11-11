import { useEffect, useState } from 'react';
import { Loader2, Mail, Play, Save, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type SmtpSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_email: string;
  from_name: string;
};

type EmailTemplate = {
  event_key: string;
  title: string;
  subject_template: string;
  body_template: string;
  enabled: boolean;
  available_variables: string[];
};

const defaults: SmtpSettings = { enabled: false, host: '', port: 587, secure: false, username: '', from_email: '', from_name: 'MrHustler' };

export default function AdminEmailPanel() {
  const [settings, setSettings] = useState(defaults);
  const [password, setPassword] = useState('');
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [queueStats, setQueueStats] = useState({ pending: 0, failed: 0, sent: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const [settingsResult, templatesResult, queueResult] = await Promise.all([
      supabase.functions.invoke('admin-email', { body: { action: 'get_settings' } }),
      supabase.from('email_notification_templates').select('*').order('title'),
      supabase.rpc('admin_email_queue_stats'),
    ]);
    const errors = [settingsResult.error, templatesResult.error, queueResult.error].filter(Boolean);
    if (errors.length) setMessage(errors[0]?.message ?? 'Could not load email settings.');
    if (settingsResult.data?.settings) {
      const { password_configured, ...safeSettings } = settingsResult.data.settings;
      setSettings({ ...defaults, ...safeSettings });
      setPasswordConfigured(Boolean(password_configured));
    }
    const templateRows = (templatesResult.data ?? []) as EmailTemplate[];
    setTemplates(templateRows);
    setSelectedKey(current => current || templateRows[0]?.event_key || '');
    if (queueResult.data) setQueueStats({ pending: Number(queueResult.data.pending ?? 0), failed: Number(queueResult.data.failed ?? 0), sent: Number(queueResult.data.sent ?? 0) });
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const selectedTemplate = templates.find(template => template.event_key === selectedKey) ?? null;

  function updateTemplate(key: keyof EmailTemplate, value: string | boolean) {
    setTemplates(current => current.map(template => template.event_key === selectedKey ? { ...template, [key]: value } : template));
  }

  async function saveSmtp(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const { data, error } = await supabase.functions.invoke('admin-email', { body: { action: 'save_settings', settings, password } });
    setSaving(false);
    if (error || data?.error) {
      setMessage(data?.error ?? error?.message ?? 'Could not save SMTP settings.');
      return;
    }
    setPassword('');
    setPasswordConfigured(Boolean(data?.password_configured));
    setMessage('SMTP settings saved securely.');
  }

  async function testSmtp() {
    setTesting(true);
    setMessage('');
    const { data, error } = await supabase.functions.invoke('admin-email', { body: { action: 'test' } });
    setTesting(false);
    setMessage(error ? error.message : data?.error ?? `Test email sent to ${data?.recipient ?? 'your admin account'}.`);
  }

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTemplate) return;
    setSaving(true);
    const { error } = await supabase.from('email_notification_templates').update({
      title: selectedTemplate.title,
      subject_template: selectedTemplate.subject_template,
      body_template: selectedTemplate.body_template,
      enabled: selectedTemplate.enabled,
      updated_at: new Date().toISOString(),
    }).eq('event_key', selectedTemplate.event_key);
    setSaving(false);
    setMessage(error ? error.message : 'Email template saved.');
  }

  async function processQueue() {
    setProcessing(true);
    setMessage('');
    const { data, error } = await supabase.functions.invoke('admin-email', { body: { action: 'process_queue' } });
    setProcessing(false);
    if (error || data?.error) {
      setMessage(data?.error ?? error?.message ?? 'Could not process the email queue.');
      return;
    }
    setMessage(`Queue processed: ${data.sent} sent, ${data.failed} failed, ${data.skipped} skipped.`);
    await load();
  }

  if (loading) return <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading email settings</p>;

  return (
    <div className="space-y-7">
      <header className="flex items-start gap-3 border-b border-white/10 pb-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center bg-amber-400/10 text-amber-300"><Mail size={18} /></div><div><h2 className="text-lg font-bold">Email notifications</h2><p className="mt-1 text-xs text-gray-400">SMTP credentials are encrypted server-side. The password is never returned to the browser or stored in plaintext.</p></div></header>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}

      <form onSubmit={saveSmtp} className="space-y-4 border-b border-white/10 pb-6">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold">SMTP connection</h3><label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))} className="accent-amber-400" />Enable queued email</label></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-gray-400">SMTP host<input required value={settings.host} onChange={event => setSettings(current => ({ ...current, host: event.target.value }))} placeholder="smtp.example.com" className="admin-input mt-1" /></label>
          <label className="text-xs text-gray-400">Port<input required type="number" min="1" max="65535" value={settings.port} onChange={event => setSettings(current => ({ ...current, port: Number(event.target.value) }))} className="admin-input mt-1" /></label>
          <label className="text-xs text-gray-400">Username<input value={settings.username} onChange={event => setSettings(current => ({ ...current, username: event.target.value }))} className="admin-input mt-1" /></label>
          <label className="text-xs text-gray-400">Sender email<input required type="email" value={settings.from_email} onChange={event => setSettings(current => ({ ...current, from_email: event.target.value }))} className="admin-input mt-1" /></label>
          <label className="text-xs text-gray-400">Sender name<input value={settings.from_name} onChange={event => setSettings(current => ({ ...current, from_name: event.target.value }))} className="admin-input mt-1" /></label>
          <label className="text-xs text-gray-400">SMTP password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder={passwordConfigured ? 'Saved securely; leave blank to keep' : 'Enter SMTP password'} className="admin-input mt-1" /></label>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={settings.secure} onChange={event => setSettings(current => ({ ...current, secure: event.target.checked }))} className="accent-amber-400" />Use implicit TLS (typically port 465)</label>
        <div className="flex flex-wrap gap-2"><button disabled={saving} className="inline-flex items-center gap-2 bg-amber-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save SMTP settings</button><button type="button" disabled={testing || !passwordConfigured} onClick={() => void testSmtp()} className="inline-flex items-center gap-2 border border-white/10 px-4 py-2.5 text-sm text-gray-300 disabled:opacity-40">{testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Send test email</button></div>
      </form>

      <section className="space-y-3 border-b border-white/10 pb-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold">Notification queue</h3><p className="mt-1 text-xs text-gray-500">{queueStats.pending} pending · {queueStats.failed} failed · {queueStats.sent} sent</p></div><button type="button" disabled={processing || !settings.enabled} onClick={() => void processQueue()} className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs text-gray-300 disabled:opacity-40">{processing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}Process pending notifications</button></div><p className="text-[11px] text-gray-500">Database events queue email automatically. Use this button for manual delivery, or configure a trusted scheduler with the EMAIL_QUEUE_SECRET header for unattended delivery.</p></section>

      <section className="grid gap-5 lg:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)]">
        <div className="divide-y divide-white/8 border-y border-white/8">{templates.map(template => <button key={template.event_key} type="button" onClick={() => setSelectedKey(template.event_key)} className={`w-full py-3 text-left ${selectedKey === template.event_key ? 'text-amber-300' : 'text-gray-300'}`}><span className="block text-xs font-semibold">{template.title}</span><span className="mt-1 block text-[10px] text-gray-500">{template.enabled ? 'Enabled' : 'Disabled'}</span></button>)}</div>
        {selectedTemplate && <form onSubmit={saveTemplate} className="space-y-3"><h3 className="text-sm font-bold">Edit {selectedTemplate.title}</h3><label className="block text-xs text-gray-400">Subject<input required maxLength={200} value={selectedTemplate.subject_template} onChange={event => updateTemplate('subject_template', event.target.value)} className="admin-input mt-1" /></label><label className="block text-xs text-gray-400">Message<textarea required maxLength={10000} rows={7} value={selectedTemplate.body_template} onChange={event => updateTemplate('body_template', event.target.value)} className="admin-input mt-1 resize-y" /></label><div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={selectedTemplate.enabled} onChange={event => updateTemplate('enabled', event.target.checked)} className="accent-amber-400" />Template enabled</label><button disabled={saving} className="inline-flex items-center gap-2 bg-amber-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-50"><Save size={14} />Save template</button></div><p className="text-[10px] leading-relaxed text-gray-500">Variables: {selectedTemplate.available_variables.map(variable => `{{${variable}}}`).join(', ')}</p></form>}
      </section>
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}`}</style>
    </div>
  );
}
