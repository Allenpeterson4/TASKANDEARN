import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext } from '@/hooks/themeContext';
import { defaultThemeColors, type Theme, type ThemeColors } from '@/hooks/themeContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

function readCachedColors(): ThemeColors {
  try {
    const stored = localStorage.getItem('mrhustler-theme-colors');
    return stored ? { ...defaultThemeColors, ...JSON.parse(stored) } : defaultThemeColors;
  } catch {
    return defaultThemeColors;
  }
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
    if (!isSupabaseConfigured) return;
    let active = true;
    supabase.from('site_content').select('content_key, body').in('content_key', ['theme.colors', 'branding.favicon'])
      .then(({ data }) => {
        if (!active || !data) return;
        const content = Object.fromEntries(data.map(entry => [entry.content_key, entry.body]));
        if (content['theme.colors']) {
          try {
            setColors({ ...defaultThemeColors, ...JSON.parse(content['theme.colors']) });
          } catch {
            // Ignore invalid palette data and retain the last cached colors.
          }
        }
        const faviconPath = content['branding.favicon'];
        if (faviconPath && !/^https?:\/\//i.test(faviconPath)) {
          let icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
          if (!icon) {
            icon = document.createElement('link');
            icon.rel = 'icon';
            document.head.append(icon);
          }
          icon.href = supabase.storage.from('site-media').getPublicUrl(faviconPath).data.publicUrl;
          icon.type = faviconPath.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        }
      });
    return () => { active = false; };
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