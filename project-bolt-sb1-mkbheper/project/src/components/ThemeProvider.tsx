import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext } from '@/hooks/themeContext';
import { defaultThemeColors, type Theme, type ThemeColors } from '@/hooks/themeContext';
import { mysqlApi } from '@/lib/platformTypes';
import { imageContentType, publicImageUrl } from '@/lib/publicImageUrl';

function readCachedColors(): ThemeColors {
  try {
    const stored = localStorage.getItem('mrhustler-theme-colors');
    return stored ? { ...defaultThemeColors, ...JSON.parse(stored) } : defaultThemeColors;
  } catch {
    return defaultThemeColors;
  }
}

function updateBrandMeta(path: string | undefined) {
  if (!path) return;
  const imageUrl = publicImageUrl(path);
  if (!imageUrl) return;
  for (const [selector, attribute, value] of [
    ['meta[property="og:image"]', 'property', 'og:image'],
    ['meta[name="twitter:image"]', 'name', 'twitter:image'],
  ]) {
    let meta = document.querySelector<HTMLMetaElement>(selector);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attribute, value);
      document.head.append(meta);
    }
    meta.content = imageUrl;
  }
  let card = document.querySelector<HTMLMetaElement>('meta[name="twitter:card"]');
  if (!card) {
    card = document.createElement('meta');
    card.name = 'twitter:card';
    document.head.append(card);
  }
  card.content = 'summary_large_image';
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('rewardpeak-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [colors, setColors] = useState<ThemeColors>(readCachedColors);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('rewardpeak-theme', theme);
    } catch {
      // Keep the selected theme for this session if storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-accent', colors.accent);
    root.style.setProperty('--brand-accent-secondary', colors.accentSecondary);
    root.style.setProperty('--brand-success', colors.success);
    root.style.setProperty('--brand-danger', colors.danger);
    root.style.setProperty('--brand-info', colors.info);
    root.style.setProperty('--theme-dark-background', colors.darkBackground);
    root.style.setProperty('--theme-dark-surface', colors.darkSurface);
    root.style.setProperty('--theme-dark-text', colors.darkText);
    root.style.setProperty('--theme-dark-muted', colors.darkMuted);
    root.style.setProperty('--theme-dark-border', colors.darkBorder);
    root.style.setProperty('--theme-light-background', colors.lightBackground);
    root.style.setProperty('--theme-light-surface', colors.lightSurface);
    root.style.setProperty('--theme-light-text', colors.lightText);
    root.style.setProperty('--theme-light-muted', colors.lightMuted);
    root.style.setProperty('--theme-light-border', colors.lightBorder);
    try {
      localStorage.setItem('mrhustler-theme-colors', JSON.stringify(colors));
    } catch {
      // Keep theme colors available for this session when storage is unavailable.
    }
  }, [colors]);

  useEffect(() => {
    let active = true;
    const refreshBranding = () => {
      void mysqlApi.from('site_content').select('content_key, body').in('content_key', ['theme.colors', 'branding.favicon', 'branding.site_logo', 'branding.logo'])
        .then(({ data }) => {
          if (!active || !data) return;
          const content = Object.fromEntries(data.map((entry: { content_key: string; body: string }) => [entry.content_key, entry.body]));
          if (content['theme.colors']) {
            try {
              setColors({ ...defaultThemeColors, ...JSON.parse(content['theme.colors']) });
            } catch {
              // Ignore invalid palette data and retain the last cached colors.
            }
          }
          const faviconPath = content['branding.favicon'];
          if (faviconPath) {
            let icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
            if (!icon) {
              icon = document.createElement('link');
              icon.rel = 'icon';
              document.head.append(icon);
            }
            icon.href = publicImageUrl(faviconPath) ?? '';
            icon.type = imageContentType(faviconPath);
          } else {
            document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.remove();
          }
          updateBrandMeta(content['branding.site_logo'] || content['branding.logo']);
        });
    };
    const handleSiteContentUpdate = (event: Event) => {
      const { key, body } = (event as CustomEvent<{ key: string; body: string }>).detail;
      if (key === 'branding.site_logo' || key === 'branding.logo') updateBrandMeta(body);
    };
    refreshBranding();
    const timer = window.setInterval(refreshBranding, 30000);
    window.addEventListener('focus', refreshBranding);
    window.addEventListener('site-content-updated', handleSiteContentUpdate);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshBranding);
      window.removeEventListener('site-content-updated', handleSiteContentUpdate);
    };
  }, []);

  function toggleTheme() {
    setTheme(current => current === 'dark' ? 'light' : 'dark');
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colors, setColors }}>
      {children}
    </ThemeContext.Provider>
  );
}