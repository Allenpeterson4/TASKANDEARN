import { useEffect, useState } from 'react';
import { mysqlApi } from '@/lib/platformTypes';

type SiteContent = Record<string, string>;
const cachePrefix = 'site-content:';

function readCachedContent(keys: string[]): SiteContent {
  try {
    return Object.fromEntries(keys.flatMap(key => {
      const body = localStorage.getItem(`${cachePrefix}${key}`);
      return body === null ? [] : [[key, body]];
    }));
  } catch {
    return {};
  }
}

export function cacheSiteContent(key: string, body: string) {
  try {
    localStorage.setItem(`${cachePrefix}${key}`, body);
  } catch {
    // Keep site content usable when browser storage is unavailable.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('site-content-updated', { detail: { key, body } }));
  }
  if (key === 'branding.favicon' && typeof document !== 'undefined') {
    const existingIcon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!body || /^https?:\/\//i.test(body)) {
      existingIcon?.remove();
      return;
    }
    const icon = existingIcon ?? document.createElement('link');
    icon.rel = 'icon';
    icon.href = mysqlApi.storage.from('site-media').getPublicUrl(body).data.publicUrl;
    icon.type = body.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    if (!existingIcon) document.head.append(icon);
  }
}

export function useSiteContent(keys: string[]) {
  const [content, setContent] = useState<SiteContent>(() => readCachedContent(keys));
  const keyList = keys.join(',');

  useEffect(() => {
    if (!keyList) return;
    let active = true;
    const requestedKeys = keyList.split(',');

    const refresh = () => {
      void mysqlApi.from('site_content').select('content_key, body').in('content_key', requestedKeys)
        .then(({ data }) => {
          if (!active || !data) return;
          const freshContent = Object.fromEntries(requestedKeys.map(key => [key, ''])) as SiteContent;
          data.forEach((entry: { content_key: string; body: string }) => { freshContent[entry.content_key] = entry.body; });
          setContent(freshContent);
          Object.entries(freshContent).forEach(([key, body]) => cacheSiteContent(key, body));
        });
    };
    const handleContentUpdate = (event: Event) => {
      const { key, body } = (event as CustomEvent<{ key: string; body: string }>).detail;
      if (!requestedKeys.includes(key)) return;
      setContent(current => ({ ...current, [key]: body }));
    };

    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('site-content-updated', handleContentUpdate);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('site-content-updated', handleContentUpdate);
    };
  }, [keyList]);

  return content;
}
