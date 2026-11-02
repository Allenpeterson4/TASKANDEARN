import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type SiteContent = Record<string, string>;

export function useSiteContent(keys: string[]) {
  const [content, setContent] = useState<SiteContent>({});
  const keyList = keys.join(',');

  useEffect(() => {
    if (!isSupabaseConfigured || !keyList) return;
    let active = true;
    const requestedKeys = keyList.split(',');

    supabase.from('site_content').select('content_key, body').in('content_key', requestedKeys)
      .then(({ data }) => {
        if (!active || !data) return;
        setContent(Object.fromEntries(data.map(entry => [entry.content_key, entry.body])));
      });

    return () => { active = false; };
  }, [keyList]);

  return content;
}
