import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export default function ActivityTracker({ userId }: { userId: string }) {
  const lastSentAt = useRef(Date.now());
  const pendingInteractions = useRef(0);

  useEffect(() => {
    function countInteraction() {
      pendingInteractions.current = Math.min(50, pendingInteractions.current + 1);
    }
    async function recordActivity() {
      const now = Date.now();
      const elapsed = Math.min(120, Math.floor((now - lastSentAt.current) / 1000));
      lastSentAt.current = now;
      const interactions = pendingInteractions.current;
      pendingInteractions.current = 0;
      const { error } = await supabase.rpc('record_user_activity', {
        p_elapsed_seconds: elapsed,
        p_interactions: interactions,
      });
      if (error) console.warn('Activity update was not recorded:', error.message);
    }

    document.addEventListener('click', countInteraction, true);
    document.addEventListener('keydown', countInteraction, true);
    const timer = window.setInterval(() => { void recordActivity(); }, 60000);
    return () => {
      document.removeEventListener('click', countInteraction, true);
      document.removeEventListener('keydown', countInteraction, true);
      window.clearInterval(timer);
    };
  }, [userId]);

  return null;
}
