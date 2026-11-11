import { useState } from 'react';
import { Check, Palette, RotateCcw, Save } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { defaultThemeColors, type ThemeColors } from '@/hooks/themeContext';
import { supabase } from '@/lib/supabase';

const colorFields: { key: keyof ThemeColors; label: string; group: string }[] = [
  { key: 'accent', label: 'Primary accent', group: 'Brand colors' },
  { key: 'accentSecondary', label: 'Secondary accent', group: 'Brand colors' },
  { key: 'success', label: 'Success', group: 'Status colors' },
  { key: 'danger', label: 'Danger', group: 'Status colors' },
  { key: 'info', label: 'Information', group: 'Status colors' },
  { key: 'darkBackground', label: 'Page background', group: 'Dark theme' },
  { key: 'darkSurface', label: 'Surface', group: 'Dark theme' },
  { key: 'darkText', label: 'Primary text', group: 'Dark theme' },
  { key: 'darkMuted', label: 'Secondary text', group: 'Dark theme' },
  { key: 'darkBorder', label: 'Borders', group: 'Dark theme' },
  { key: 'lightBackground', label: 'Page background', group: 'Light theme' },
  { key: 'lightSurface', label: 'Surface', group: 'Light theme' },
  { key: 'lightText', label: 'Primary text', group: 'Light theme' },
  { key: 'lightMuted', label: 'Secondary text', group: 'Light theme' },
  { key: 'lightBorder', label: 'Borders', group: 'Light theme' },
];

const groups = [...new Set(colorFields.map(field => field.group))];

export default function AdminThemeColorsPanel() {
  const { colors, setColors } = useTheme();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  function updateColor(key: keyof ThemeColors, value: string) {
    setColors({ ...colors, [key]: value });
  }

  async function saveColors(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from('site_content').upsert({
      content_key: 'theme.colors',
      title: 'Interface color palette',
      body: JSON.stringify(colors),
      updated_at: new Date().toISOString(),
      updated_by: user.user?.id,
    }, { onConflict: 'content_key' });
    setSaving(false);
    setMessage(error ? error.message : 'Palette saved and published across the site.');
  }

  return (
    <form onSubmit={saveColors} className="space-y-6">
      <header className="flex items-start gap-3 border-b border-white/10 pb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-amber-400/10 text-amber-300"><Palette size={18} /></div>
        <div><h2 className="text-lg font-bold">Site color palette</h2><p className="mt-1 text-xs text-gray-400">Changes preview immediately and apply across the public site, user dashboard, and admin console after saving.</p></div>
      </header>
      {groups.map(group => <section key={group} className="space-y-3">
        <h3 className="text-sm font-bold text-gray-300">{group}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colorFields.filter(field => field.group === group).map(field => <label key={field.key} className="flex min-w-0 items-center gap-3 border border-white/8 p-3 text-xs text-gray-300">
            <input type="color" value={colors[field.key]} onChange={event => updateColor(field.key, event.target.value)} aria-label={field.label} className="h-9 w-12 shrink-0 cursor-pointer border-0 bg-transparent p-0" />
            <span className="min-w-0 flex-1">{field.label}<code className="mt-1 block text-[10px] text-gray-500">{colors[field.key].toUpperCase()}</code></span>
          </label>)}
        </div>
      </section>)}
      <section className="grid gap-3 sm:grid-cols-2">
        {(['dark', 'light'] as const).map(mode => <div key={mode} style={{ backgroundColor: mode === 'dark' ? colors.darkBackground : colors.lightBackground, color: mode === 'dark' ? colors.darkText : colors.lightText }} className="overflow-hidden border p-4" >
          <p className="text-xs font-bold uppercase">{mode} theme preview</p>
          <div style={{ backgroundColor: mode === 'dark' ? colors.darkSurface : colors.lightSurface }} className="mt-3 flex items-center justify-between gap-3 p-3">
            <span style={{ color: mode === 'dark' ? colors.darkMuted : colors.lightMuted }} className="text-xs">Balance overview</span>
            <strong style={{ color: colors.accent }} className="text-sm">₦1,550.00</strong>
          </div>
          <button type="button" style={{ backgroundColor: colors.accent, color: mode === 'dark' ? colors.darkBackground : colors.lightSurface }} className="mt-3 px-3 py-2 text-xs font-bold">Primary action</button>
        </div>)}
      </section>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 bg-amber-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? 'Saving…' : <><Save size={15} />Save palette</>}</button>
        <button type="button" onClick={() => setColors(defaultThemeColors)} className="inline-flex items-center gap-2 border border-white/10 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5"><RotateCcw size={14} />Reset preview</button>
        {!saving && message.startsWith('Palette saved') && <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={14} />Published</span>}
      </div>
    </form>
  );
}
