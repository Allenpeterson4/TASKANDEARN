import { useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Preloader from '@/components/Preloader';
import PublicSite from '@/components/PublicSite';
import AuthPage from '@/components/dashboard/AuthPage';
import Dashboard from '@/components/dashboard/Dashboard';
import AdminPanel from '@/components/dashboard/AdminPanel';
import AdminMfaGate from '@/components/dashboard/AdminMfaGate';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

type AuthMode = 'login' | 'signup';

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const isPasswordReset = new URLSearchParams(location.search).has('reset-password');

  const handlePreloaderFinish = useCallback(() => setLoaded(true), []);

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setShowAuth(true);
  }

  if (!loaded || authLoading) {
    return <Preloader ready={!authLoading} onFinish={handlePreloaderFinish} />;
  }

  if (isPasswordReset) {
    return <AuthPage initialMode="reset" onBack={() => navigate('/')} />;
  }

  if (isAdminRoute) {
    if (user?.app_metadata?.role === 'admin') {
      const adminPanel = <AdminPanel user={user} />;
      return user.app_metadata.mfa_required === true
        ? <AdminMfaGate user={user}>{adminPanel}</AdminMfaGate>
        : adminPanel;
    }
    if (user) {
      return (
        <div className="min-h-screen bg-[#080808] flex items-center justify-center px-4 text-center">
          <div className="max-w-md">
            <h1 className="text-white text-2xl font-black">Admin access required</h1>
            <p className="text-gray-400 text-sm mt-2">This account is not authorized to use the administration console.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button onClick={() => supabase.auth.signOut()} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5">Sign out</button>
              <button onClick={() => navigate('/')} className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-bold text-black">Return home</button>
            </div>
          </div>
        </div>
      );
    }
    return <AuthPage adminOnly onBack={() => navigate('/')} />;
  }

  if (user) return <Dashboard user={user} />;

  if (showAuth) {
    return <AuthPage initialMode={authMode} onBack={() => setShowAuth(false)} />;
  }

  return <PublicSite onAuthRequest={openAuth} />;
}
