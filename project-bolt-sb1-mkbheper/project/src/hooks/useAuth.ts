import { useState, useEffect } from 'react';
import { mysqlApi, type AppUser } from '@/lib/mysqlApi';

export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const refreshUser = () => {
      void mysqlApi.auth.getSession()
        .then(nextUser => { if (active) setUser(nextUser); })
        .catch(() => { if (active) setUser(null); })
        .finally(() => { if (active) setLoading(false); });
    };
    refreshUser();
    const unsubscribe = mysqlApi.auth.subscribe(refreshUser);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { user, loading };
}
