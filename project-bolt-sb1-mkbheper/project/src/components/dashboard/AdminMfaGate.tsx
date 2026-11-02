import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Props {
  user: User;
  children: ReactNode;
}

export default function AdminMfaGate({ user, children }: Props) {
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function prepare() {
      const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) {
        if (active) setError(assuranceError.message);
        if (active) setLoading(false);
        return;
      }
      if (assurance.currentLevel === 'aal2') {
        if (active) setVerified(true);
        if (active) setLoading(false);
        return;
      }

      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) {
        if (active) setError(factorsError.message);
        if (active) setLoading(false);
        return;
      }
      const verifiedFactor = factors.totp.find(factor => factor.status === 'verified');
      if (verifiedFactor) {
        if (active) setFactorId(verifiedFactor.id);
        if (active) setLoading(false);
        return;
      }

      const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Admin authenticator',
      });
      if (enrollmentError) {
        if (active) setError(enrollmentError.message);
      } else if (active) {
        setFactorId(enrollment.id);
        setQrCode(enrollment.totp.qr_code);
        setSecret(enrollment.totp.secret);
      }
      if (active) setLoading(false);
    }

    prepare();
    return () => { active = false; };
  }, [user.id]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setLoading(false);
    if (verifyError) {
      setError('Verification failed. Check the code and try again.');
      return;
    }
    setVerified(true);
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
        {!loading && qrCode && <div className="space-y-3 text-center"><p className="text-sm text-gray-300">Scan this code, then enter the six-digit code from your authenticator app.</p><img src={qrCode} alt="Authenticator setup QR code" className="mx-auto h-48 w-48 bg-white p-2" /><details className="text-left text-xs text-gray-400"><summary className="cursor-pointer">Enter setup key manually</summary><code className="mt-2 block break-all bg-black/20 p-3">{secret}</code></details></div>}
        {!loading && factorId && !qrCode && <p className="text-sm text-gray-300">Enter the code from your authenticator app.</p>}
        {!loading && factorId && <label className="block text-xs text-gray-400">Verification code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} className="admin-input mt-1 text-center text-lg tracking-[0.3em]" /></label>}
        {error && <p role="alert" className="border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300">{error}</p>}
        <button disabled={loading || !factorId} className="w-full rounded-lg bg-emerald-300 px-4 py-3 text-sm font-bold text-black disabled:opacity-50">Verify and continue</button>
      </form>
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.7rem .75rem;color:#fff;font-size:.875rem;outline:none}`}</style>
    </div>
  );
}
