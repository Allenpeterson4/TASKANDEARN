import { useEffect, useState } from 'react';
import { Activity, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type AdminEvent = {
  id: string;
  actor_id: string;
  subject_user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

type LoginEvent = {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string;
  created_at: string;
};

type ProfileName = { user_id: string; full_name: string; username: string };

export default function AdminActivityPanel() {
  const [mode, setMode] = useState<'admin' | 'logins'>('admin');
  const [adminEvents, setAdminEvents] = useState<AdminEvent[]>([]);
  const [loginEvents, setLoginEvents] = useState<LoginEvent[]>([]);
  const [names, setNames] = useState<Map<string, ProfileName>>(new Map());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      const [adminResult, loginResult] = await Promise.all([
        supabase.from('admin_activity_log').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('user_login_history').select('*').order('created_at', { ascending: false }).limit(200),
      ]);

      const requestError = adminResult.error ?? loginResult.error;
      if (requestError) {
        if (active) setError(requestError.message);
        if (active) setLoading(false);
        return;
      }

      const adminRows = (adminResult.data ?? []) as AdminEvent[];
      const loginRows = (loginResult.data ?? []) as LoginEvent[];
      const userIds = [...new Set([
        ...adminRows.flatMap(event => [event.actor_id, event.subject_user_id].filter((id): id is string => !!id)),
        ...loginRows.map(event => event.user_id),
      ])];
      const profileResult = userIds.length
        ? await supabase.from('profiles').select('user_id, full_name, username').in('user_id', userIds)
        : { data: [], error: null };
      if (profileResult.error) {
        if (active) setError(profileResult.error.message);
        if (active) setLoading(false);
        return;
      }
      if (active) {
        setAdminEvents(adminRows);
        setLoginEvents(loginRows);
        setNames(new Map(((profileResult.data ?? []) as ProfileName[]).map(profile => [profile.user_id, profile])));
        setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, []);

  const query = search.trim().toLowerCase();
  const filteredAdmin = adminEvents.filter(event => {
    const actor = names.get(event.actor_id);
    const subject = event.subject_user_id ? names.get(event.subject_user_id) : undefined;
    return !query || `${event.action} ${actor?.full_name} ${actor?.username} ${subject?.full_name} ${JSON.stringify(event.details)}`.toLowerCase().includes(query);
  });
  const filteredLogins = loginEvents.filter(event => {
    const profile = names.get(event.user_id);
    return !query || `${profile?.full_name} ${profile?.username} ${event.ip_address} ${event.user_agent}`.toLowerCase().includes(query);
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button onClick={() => setMode('admin')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'admin' ? 'bg-emerald-300 text-black' : 'text-gray-400 hover:bg-white/5'}`}>Admin actions</button>
          <button onClick={() => setMode('logins')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'logins' ? 'bg-emerald-300 text-black' : 'text-gray-400 hover:bg-white/5'}`}>Login history</button>
        </div>
        <label className="flex w-full max-w-sm items-center gap-2 border border-white/10 px-3 py-2 text-gray-400">
          <Search size={15} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search events" className="w-full bg-transparent text-sm text-white outline-none" />
        </label>
      </div>

      {error && <div role="alert" className="border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? (
        <div className="flex min-h-40 items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin" size={17} /> Loading activity</div>
      ) : mode === 'admin' ? (
        <div className="divide-y divide-white/8 border-y border-white/8">
          {filteredAdmin.map(event => {
            const actor = names.get(event.actor_id);
            const subject = event.subject_user_id ? names.get(event.subject_user_id) : undefined;
            return (
              <article key={event.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="flex items-start gap-3">
                  <Activity size={16} className="mt-0.5 text-emerald-300" />
                  <div>
                    <p className="text-sm font-semibold">{event.action.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      By {actor?.full_name || actor?.username || event.actor_id}
                      {subject ? ` · User ${subject.full_name || subject.username || event.subject_user_id}` : ''}
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] text-gray-500">{JSON.stringify(event.details, null, 2)}</pre>
                  </div>
                </div>
                <time className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString('en-NG')}</time>
              </article>
            );
          })}
          {filteredAdmin.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No admin actions match this search.</p>}
        </div>
      ) : (
        <div className="divide-y divide-white/8 border-y border-white/8">
          {filteredLogins.map(event => {
            const profile = names.get(event.user_id);
            return (
              <article key={event.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <p className="text-sm font-semibold">{profile?.full_name || profile?.username || event.user_id}</p>
                  <p className="text-xs text-gray-500">{event.ip_address || 'IP unavailable'}</p>
                </div>
                <p className="break-all text-xs text-gray-400">{event.user_agent || 'Device details unavailable'}</p>
                <time className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString('en-NG')}</time>
              </article>
            );
          })}
          {filteredLogins.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No login history matches this search.</p>}
        </div>
      )}
      <p className="text-xs text-gray-500">Showing up to 200 recent records. IP location is not collected.</p>
    </section>
  );
}
