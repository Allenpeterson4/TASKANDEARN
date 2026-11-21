import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { mysqlApi } from '@/lib/platformTypes';

type MfaStatus = { enabled: boolean; verified: boolean };

export default function AdminMfaSettingsPanel() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    mysqlApi.auth.mfaStatus()
      .then(nextStatus => { if (active) setStatus(nextStatus); })
      .catch(loadError => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load security settings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function enableMfa() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const enrollment = await mysqlApi.auth.enrollMfa();
      setSecret(enrollment.secret);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start authenticator setup.');
    } finally {
      setSaving(false);
    }
  }

  async function verifyMfa(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await mysqlApi.auth.verifyMfa(code.trim());
      setStatus({ enabled: true, verified: true });
      setSecret('');
      setCode('');
      setMessage('Two-factor authentication is enabled for your administrator account.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not verify the authenticator code.');
    } finally {
      setSaving(false);
    }
  }

  async function disableMfa() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await mysqlApi.auth.disableMfa();
      setStatus({ enabled: false, verified: true });
      setSecret('');
      setMessage('Two-factor authentication has been disabled.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not disable two-factor authentication.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl space-y-5">
      <header className="flex items-start gap-3 border-b border-white/10 pb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-emerald-400/10 text-emerald-300"><ShieldCheck size={18} /></div>
        <div>
          <h2 className="text-lg font-bold">Admin security</h2>
          <p className="mt-1 text-sm text-gray-400">Authenticator verification is optional. It is required for future admin sessions only after you enable it here.</p>
        </div>
      </header>

      <div className="border border-white/10 bg-white/[0.02] p-5">
        {loading ? (
          <p className="text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading security settings</p>
        ) : !status ? (
          <p className="text-sm text-gray-400">Security settings could not be loaded. Retry the section before changing 2FA.</p>
        ) : status?.enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-emerald-300">Authenticator enabled</p>
              <p className="mt-1 text-xs text-gray-400">Your admin account will request a one-time code when you sign in.</p>
            </div>
            <button type="button" disabled={saving} onClick={() => void disableMfa()} className="border border-red-400/25 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-400/10 disabled:opacity-50">
              {saving ? 'Updating…' : 'Disable authenticator'}
            </button>
          </div>
        ) : secret ? (
          <form onSubmit={verifyMfa} className="space-y-4">
            <p className="text-sm text-gray-300">Add this setup key to your authenticator app, then enter its six-digit code to enable 2FA.</p>
            <code className="block select-all break-all border border-white/10 bg-black/20 p-3 text-center text-sm tracking-widest text-emerald-200">{secret}</code>
            <label className="block text-xs text-gray-400">
              Verification code
              <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} className="admin-input mt-1 text-center text-lg tracking-[0.3em]" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={saving || code.trim().length !== 6} className="bg-emerald-300 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? 'Verifying…' : 'Verify and enable'}</button>
              <button type="button" disabled={saving} onClick={() => { setSecret(''); setCode(''); }} className="border border-white/10 px-4 py-2.5 text-sm text-gray-300 disabled:opacity-50">Cancel setup</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold">Authenticator not enabled</p>
              <p className="mt-1 text-xs text-gray-400">Admin sign-in uses your account email and password until you enable this option.</p>
            </div>
            <button type="button" disabled={saving} onClick={() => void enableMfa()} className="bg-emerald-300 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">
              {saving ? 'Preparing…' : 'Enable 2FA'}
            </button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="border border-emerald-400/25 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">{message}</p>}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.7rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(110,231,183,.55)}`}</style>
    </section>
  );
}
