import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const loadingTimeout = window.setTimeout(() => {
      if (active) setLoading(false);
    }, 8000);

    supabase.auth.getSession()
      .then(({ data }) => { if (active) setUser(data.session?.user ?? null); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => {
        window.clearTimeout(loadingTimeout);
        if (active) setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (event === 'SIGNED_IN' && session?.user) {
        window.setTimeout(() => {
          void supabase.functions.invoke('capture-login');
        }, 0);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
