import { useEffect, useState } from 'react';
import { FileText, Image, Loader2, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { cacheSiteContent } from '@/hooks/useSiteContent';
import { supabase } from '@/lib/supabase';

type ContentEntry = {
  content_key: string;
  title: string;
  body: string;
  updated_at: string;
};

type MediaItem = {
  name: string;
  created_at: string | null;
};

type ContentMode = 'copy' | 'media';

function isImageContentKey(contentKey: string) {
  return /(?:image|logo|favicon)/i.test(contentKey);
}

function isBrandAssetKey(contentKey: string) {
  return /(?:logo|favicon)/i.test(contentKey);
}

function isBrandingEntry(contentKey: string) {
  return contentKey.toLowerCase().startsWith('branding.');
}

export default function AdminContentPanel() {
  const [mode, setMode] = useState<ContentMode>('copy');
  const [entries, setEntries] = useState<ContentEntry[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState({ content_key: '', title: '', body: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function loadContent() {
    setLoading(true);
    const [contentResult, mediaResult] = await Promise.all([
      supabase.from('site_content').select('*').order('content_key'),
      supabase.storage.from('site-media').list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
    ]);
    const error = contentResult.error ?? mediaResult.error;
    if (error) setMessage(error.message);
    setEntries((contentResult.data ?? []) as ContentEntry[]);
    setMedia((mediaResult.data ?? []).map(item => ({ name: item.name, created_at: item.created_at ?? null })));
    setLoading(false);
  }

  useEffect(() => {
    loadContent();
  }, []);

  function selectEntry(entry: ContentEntry) {
    setSelected(entry.content_key);
    setDraft({ content_key: entry.content_key, title: entry.title, body: entry.body });
  }

  function newEntry() {
    setSelected(null);
    setDraft({ content_key: '', title: '', body: '' });
  }

  const isImageContent = isImageContentKey(draft.content_key);
  const isBrandAsset = isBrandAssetKey(draft.content_key);

  function imageUrl(path: string) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return '';
    return supabase.storage.from('site-media').getPublicUrl(path).data.publicUrl;
  }

  async function uploadContentImage(file?: File) {
    if (!file) return;
    const acceptedTypes = isBrandAsset ? ['image/png', 'image/svg+xml'] : ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!acceptedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setMessage(isBrandAsset ? 'Choose a PNG or SVG image smaller than 10 MB.' : 'Choose a PNG, JPEG, WebP, or SVG image smaller than 10 MB.');
      return;
    }
    setSaving(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `cms/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from('site-media').upload(path, file, { contentType: file.type, upsert: false });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setDraft(current => ({ ...current, body: path }));
    setMessage('Image uploaded. Save content to publish it.');
  }

  async function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!selected && isBrandingEntry(draft.content_key.trim())) {
      setMessage('Manage logo and favicon files in Brand Images.');
      return;
    }
    if (isImageContent && (!draft.body || /^https?:\/\//i.test(draft.body))) {
      setMessage('Upload an image file before saving this image entry.');
      return;
    }
    setSaving(true);
    const values = { title: draft.title.trim(), body: draft.body.trim(), updated_at: new Date().toISOString() };
    const previousBody = selected ? entries.find(entry => entry.content_key === selected)?.body : undefined;
    const result = selected
      ? await supabase.from('site_content').update(values).eq('content_key', selected)
      : await supabase.from('site_content').insert({ ...values, content_key: draft.content_key.trim().toLowerCase() });
    setSaving(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (isImageContent) {
      const contentKey = selected ?? draft.content_key.trim().toLowerCase();
      cacheSiteContent(contentKey, values.body);
      if (previousBody && previousBody !== values.body && !/^https?:\/\//i.test(previousBody)) {
        await supabase.storage.from('site-media').remove([previousBody]);
      }
    }
    setMessage('Content saved.');
    await loadContent();
  }

  async function deleteEntry(entry: ContentEntry) {
    if (!window.confirm(`Delete content entry "${entry.content_key}"?`)) return;
    const { error } = await supabase.from('site_content').delete().eq('content_key', entry.content_key);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (isImageContentKey(entry.content_key)) {
      cacheSiteContent(entry.content_key, '');
      if (entry.body && !/^https?:\/\//i.test(entry.body)) await supabase.storage.from('site-media').remove([entry.body]);
    }
    if (selected === entry.content_key) newEntry();
    setMessage('Content entry deleted.');
    await loadContent();
  }

  async function uploadMedia(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      setMessage('Choose an image smaller than 10 MB.');
      return;
    }
    setSaving(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from('site-media').upload(path, file, { contentType: file.type, upsert: false });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('Image uploaded.');
    await loadContent();
  }

  async function deleteMedia(item: MediaItem) {
    if (!window.confirm(`Delete image "${item.name}"?`)) return;
    const { error } = await supabase.storage.from('site-media').remove([item.name]);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('Image deleted.');
    await loadContent();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex gap-2" role="tablist" aria-label="Content management">
          <button role="tab" aria-selected={mode === 'copy'} onClick={() => setMode('copy')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${mode === 'copy' ? 'bg-amber-400 text-black' : 'text-gray-400 hover:bg-white/5'}`}><FileText size={15} /> Site copy</button>
          <button role="tab" aria-selected={mode === 'media'} onClick={() => setMode('media')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${mode === 'media' ? 'bg-amber-400 text-black' : 'text-gray-400 hover:bg-white/5'}`}><Image size={15} /> Media</button>
        </div>
        {mode === 'copy' && <button onClick={newEntry} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 hover:bg-white/5"><Plus size={15} /> New entry</button>}
        {mode === 'media' && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-sm font-bold text-black">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload image
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadMedia} disabled={saving} className="sr-only" />
          </label>
        )}
      </div>

      {message && <div className="flex items-center justify-between gap-3 border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss message"><X size={15} /></button></div>}
      {loading ? <div className="flex min-h-40 items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin" size={17} /> Loading content</div> : mode === 'copy' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)]">
          <div className="divide-y divide-white/8 border-y border-white/8">
            {entries.filter(entry => !isBrandingEntry(entry.content_key)).map(entry => (
              <div key={entry.content_key} className={`flex items-start gap-2 py-3 ${selected === entry.content_key ? 'text-amber-300' : ''}`}>
                <button onClick={() => selectEntry(entry)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-semibold">{entry.title}</span>
                  <span className="block truncate text-xs text-gray-500">{entry.content_key}</span>
                </button>
                <button onClick={() => deleteEntry(entry)} aria-label={`Delete ${entry.title}`} className="p-1 text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
            {entries.every(entry => isBrandingEntry(entry.content_key)) && <p className="py-8 text-sm text-gray-500">No site copy entries yet.</p>}
          </div>
          <form onSubmit={saveEntry} className="space-y-4">
            <h2 className="font-bold">{selected ? 'Edit content' : 'Add content'}</h2>
            <label className="block text-xs text-gray-400">Content key<input required disabled={!!selected} pattern="[a-z0-9._-]{1,100}" maxLength={100} value={draft.content_key} onChange={event => setDraft({ ...draft, content_key: event.target.value })} placeholder="home.hero.title" className="admin-input mt-1" /></label>
            <label className="block text-xs text-gray-400">Title<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} className="admin-input mt-1" /></label>
            {isImageContent ? (
              <div className="space-y-3">
                <label className="block text-xs text-gray-400">{isBrandAsset ? 'Logo or favicon image file' : 'Image file'}<input type="file" accept={isBrandAsset ? 'image/png,image/svg+xml' : 'image/png,image/jpeg,image/webp,image/svg+xml'} disabled={saving} onChange={event => { void uploadContentImage(event.target.files?.[0]); event.currentTarget.value = ''; }} className="admin-input mt-1 file:mr-3 file:border-0 file:bg-amber-400 file:px-3 file:py-2 file:text-xs file:font-bold file:text-black" /></label>
                {draft.body && <img src={imageUrl(draft.body)} alt={`${draft.title || 'Site'} preview`} className="max-h-64 max-w-full border border-white/10 object-contain" />}
              </div>
            ) : <label className="block text-xs text-gray-400">Copy<textarea rows={7} maxLength={10000} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} className="admin-input mt-1 resize-y" /></label>}
            <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save content</button>
          </form>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map(item => {
            const { data } = supabase.storage.from('site-media').getPublicUrl(item.name);
            return (
              <article key={item.name} className="overflow-hidden border border-white/10 bg-white/3">
                <img src={data.publicUrl} alt={item.name} className="aspect-video w-full object-contain bg-black/10" />
                <div className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold">{item.name}</p><p className="text-[11px] text-gray-500">{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</p></div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => deleteMedia(item)} aria-label={`Delete ${item.name}`} className="p-2 text-gray-400 hover:text-red-300"><Trash2 size={14} /></button>
                  </div>
                </div>
              </article>
            );
          })}
          {media.length === 0 && <p className="col-span-full py-10 text-center text-sm text-gray-500">No images uploaded.</p>}
        </div>
      )}

      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}.admin-input::placeholder{color:#6b7280}`}</style>
    </div>
  );
}
