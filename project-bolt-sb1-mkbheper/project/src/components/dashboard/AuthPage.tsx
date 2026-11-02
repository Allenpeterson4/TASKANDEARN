import { useEffect, useState } from 'react';
import { Eye, EyeOff, Mail, Lock, User, Phone, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import ThemeToggle from '@/components/ThemeToggle';

type Mode = 'login' | 'signup' | 'reset';

interface Props {
  initialMode?: Mode;
  onBack?: () => void;
  adminOnly?: boolean;
}

export default function AuthPage({ initialMode = 'login', onBack, adminOnly = false }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    referralCode: new URLSearchParams(window.location.search).get('ref') ?? '',
  });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [signupCooldown, setSignupCooldown] = useState(0);

  useEffect(() => {
    if (signupCooldown === 0) return;
    const timer = window.setTimeout(() => setSignupCooldown(seconds => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [signupCooldown]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (mode === 'signup' && signupCooldown > 0) return;
    if (!isSupabaseConfigured) {
      setError('Authentication is not configured. Add the Supabase URL and anon key to the project environment.');
      return;
    }
    setLoading(true);
    if (mode === 'signup') setSignupCooldown(8);

    try {
      if (mode === 'reset') {
        const { error: err } = await supabase.auth.updateUser({ password: form.password });
        if (err) throw err;
        setInfo('Password updated. You can now sign in.');
        setMode('login');
        setForm(current => ({ ...current, password: '' }));
      } else if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.fullName, phone: form.phone, referral_code: form.referralCode } },
        });
        if (err) throw err;
        if (data.user) {
          // create profile + balance rows
          const code = Math.random().toString(36).substring(2, 8).toUpperCase();
          await supabase.from('profiles').insert({
            user_id: data.user.id,
            full_name: form.fullName,
            username: form.email.split('@')[0],
            phone: form.phone,
            tier: 'Bronze',
            referral_code: code,
          });
          await supabase.from('balances').insert({
            user_id: data.user.id,
            reward_balance: 0,
            referral_balance: 0,
            total_earned: 0,
          });
        }
        setInfo('Signup request received. Check your email for a confirmation link before signing in.');
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (err) throw err;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      if (mode === 'signup' && /security purposes|after \d+ seconds|rate limit|too many requests/i.test(message)) {
        setError('');
        setInfo('Please wait a few seconds before trying to create your account again.');
        setSignupCooldown(8);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function sendPasswordReset() {
    setError('');
    setInfo('');
    if (!form.email) {
      setError('Enter your email address first.');
      return;
    }
    if (!isSupabaseConfigured) {
      setError('Authentication is not configured. Add the Supabase URL and anon key to the project environment.');
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(form.email, {
      redirectTo: `${window.location.origin}/?reset-password=1`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setInfo('If an account exists for this email, a password reset link is on its way.');
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 py-12">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-amber-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {onBack && (
          <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={16} /> Back to home
          </button>
        )}

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-xl shadow-amber-500/20">
              <span className="text-white font-black text-2xl">M</span>
            </div>
            <span className="text-white font-black text-2xl">Mr<span className="text-amber-400">Hustler</span></span>
          </div>
          <h1 className="text-2xl font-black text-white">
            {adminOnly ? 'Admin sign in' : mode === 'reset' ? 'Reset your password' : mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {adminOnly
              ? 'Use an administrator account to continue.'
              : mode === 'reset'
              ? 'Enter a new password for your account.'
              : mode === 'login'
              ? 'Sign in to access your dashboard'
              : 'Join thousands of Nigerian earners today'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#111] border border-white/8 rounded-3xl p-8">
          {/* Tab toggle */}
          {!adminOnly && mode !== 'reset' && (
            <div className="flex bg-[#0a0a0a] rounded-xl p-1 mb-6">
              {(['login', 'signup'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(''); setInfo(''); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    mode === m
                      ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-black shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {m === 'login' ? 'Sign In' : 'Sign Up'}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">Full Name</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Chukwuemeka Obi"
                      value={form.fullName}
                      onChange={set('fullName')}
                      className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">Phone Number</label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="tel"
                      placeholder="080XXXXXXXX"
                      value={form.phone}
                      onChange={set('phone')}
                      className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">Referral Code (optional)</label>
                  <input
                    type="text"
                    value={form.referralCode}
                    onChange={set('referralCode')}
                    placeholder="Enter a friend's code"
                    maxLength={20}
                    className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
                  />
                </div>
              </>
            )}

            {mode !== 'reset' && <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Email Address</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={set('email')}
                  className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
                />
              </div>
            </div>}

            {(mode === 'signup' || mode === 'reset' || mode === 'login') && <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={form.password}
                  onChange={set('password')}
                  minLength={6}
                  className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-10 pr-10 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>}

            {!adminOnly && mode === 'login' && (
              <button type="button" onClick={sendPasswordReset} disabled={loading} className="text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50">Forgot password?</button>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}
            {info && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-green-400 text-sm">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'signup' && signupCooldown > 0)}
              className="group w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm hover:shadow-xl hover:shadow-amber-500/25 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  {mode === 'reset'
                    ? 'Update Password'
                    : mode === 'login'
                    ? 'Sign In to Dashboard'
                    : signupCooldown > 0
                    ? `Please wait ${signupCooldown}s`
                    : 'Create Free Account'}
                  {mode === 'login' || signupCooldown === 0 ? (
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  ) : null}
                </>
              )}
            </button>
          </form>

          {!adminOnly && mode === 'login' && (
            <p className="text-center text-gray-500 text-xs mt-5">
              No account?{' '}
              <button onClick={() => setMode('signup')} className="text-amber-400 hover:text-amber-300 font-semibold transition-colors">
                Sign up free
              </button>
            </p>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          By continuing you agree to our{' '}
          <a href="#" className="text-gray-400 hover:text-white transition-colors">Terms</a> &amp;{' '}
          <a href="#" className="text-gray-400 hover:text-white transition-colors">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
