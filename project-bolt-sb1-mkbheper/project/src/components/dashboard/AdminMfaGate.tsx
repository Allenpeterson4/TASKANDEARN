import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppUser } from '@/lib/mysqlApi';
import { Loader2, ShieldCheck } from 'lucide-react';
import { mysqlApi } from '@/lib/mysqlApi';

interface Props {
  user: AppUser;
  children: ReactNode;
}

export default function AdminMfaGate({ user, children }: Props) {
  const [factorReady, setFactorReady] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        const status = await mysqlApi.auth.mfaStatus();
        if (!active) return;
        if (status.verified) {
          setVerified(true);
          return;
        }
        if (!status.enabled) {
          setVerified(true);
          return;
        }
        setFactorReady(true);
      } catch (mfaError) {
        if (active) setError(mfaError instanceof Error ? mfaError.message : 'Could not prepare administrator verification.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void prepare();
    return () => { active = false; };
  }, [user.id]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await mysqlApi.auth.verifyMfa(code.trim());
      setVerified(true);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Verification failed. Check the code and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setError('');
    try {
      await mysqlApi.auth.signOut();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  if (verified) return children;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 py-10">
      <form onSubmit={verify} className="w-full max-w-md space-y-5 border border-white/10 bg-[#111] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300"><ShieldCheck size={19} /></div>
          <div><h1 className="text-lg font-bold text-white">Admin verification</h1><p className="text-xs text-gray-400">Authenticator app required</p></div>
        </div>
        {loading && <p className="text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} /> Preparing verification</p>}
        {!loading && factorReady && <p className="text-sm text-gray-300">Enter the six-digit code from your authenticator app.</p>}
        {!loading && factorReady && <label className="block text-xs text-gray-400">Verification code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} className="admin-input mt-1 text-center text-lg tracking-[0.3em]" /></label>}
        {error && <p role="alert" className="border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-sm text-amber-100">{error}</p>}
        <button type="submit" disabled={loading || !factorReady} className="w-full rounded-lg bg-emerald-300 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">Verify and continue</button>
        <button type="button" disabled={signingOut} onClick={() => void signOut()} className="w-full border border-white/10 px-4 py-3 text-sm text-gray-300 disabled:opacity-50">{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </form>
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.7rem .75rem;color:#fff;font-size:.875rem;outline:none}`}</style>
    </div>
  );
}
