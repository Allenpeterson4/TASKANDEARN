import { useEffect, useState } from 'react';
import { Image, Loader2, Trash2, Upload } from 'lucide-react';
import { cacheSiteContent } from '@/hooks/useSiteContent';
import { supabase } from '@/lib/supabase';

const logoSettings = [
  { key: 'branding.site_logo', title: 'Website logo', description: 'Upload a transparent PNG or SVG for the navigation, footer, sign-in screen, and dashboard.' },
  { key: 'branding.preloader_logo', title: 'Preloader logo', description: 'Upload a transparent PNG or SVG for the loading screen.' },
  { key: 'branding.logo', title: 'Legacy site logo', description: 'Upload or remove the older site logo entry; the main site logo is preferred when both exist.' },
  { key: 'branding.favicon', title: 'Site favicon', description: 'Upload a PNG or SVG favicon image.' },
] as const;

type LogoKey = typeof logoSettings[number]['key'];
type LogoPaths = Record<LogoKey, string>;
const emptyPaths: LogoPaths = { 'branding.site_logo': '', 'branding.preloader_logo': '', 'branding.logo': '', 'branding.favicon': '' };

export default function AdminBrandingPanel() {
  const [paths, setPaths] = useState<LogoPaths>(emptyPaths);
  const [uploading, setUploading] = useState<LogoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('site_content').select('content_key, body').in('content_key', logoSettings.map(setting => setting.key)).then(({ data, error }) => {
      if (error) setMessage(error.message);
      if (data) {
        setPaths(current => ({
          ...current,
          ...Object.fromEntries(data.map(row => [row.content_key, row.body])),
        }));
      }
      setLoading(false);
    });
  }, []);

  function publicUrl(path: string) {
    return path && !/^https?:\/\//i.test(path) ? supabase.storage.from('site-media').getPublicUrl(path).data.publicUrl : '';
  }

  async function uploadLogo(key: LogoKey, file?: File) {
    if (!file) return;
    if (!['image/png', 'image/svg+xml'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setMessage('Choose a transparent PNG or SVG smaller than 10 MB.');
      return;
    }
    setUploading(key);
    setMessage('');
    const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'image';
    const imageType = key.includes('favicon') ? 'favicon' : key.endsWith('preloader_logo') ? 'preloader' : 'site';
    const path = `branding/${imageType}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('site-media').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      setUploading(null);
      setMessage(uploadError.message);
      return;
    }

    const title = logoSettings.find(setting => setting.key === key)?.title ?? key;
    const { data: user } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from('site_content').upsert({
      content_key: key,
      title,
      body: path,
      updated_at: new Date().toISOString(),
      updated_by: user.user?.id,
    });
    setUploading(null);
    if (saveError) {
      await supabase.storage.from('site-media').remove([path]);
      setMessage(saveError.message);
      return;
    }

    const previousPath = paths[key];
    cacheSiteContent(key, path);
    setPaths(current => ({ ...current, [key]: path }));
    if (previousPath.startsWith('branding/')) await supabase.storage.from('site-media').remove([previousPath]);
    setMessage(`${title} uploaded and published.`);
  }

  async function removeLogo(key: LogoKey) {
    const previousPath = paths[key];
    const { error } = await supabase.from('site_content').upsert({
      content_key: key,
      title: logoSettings.find(setting => setting.key === key)?.title ?? key,
      body: '',
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    cacheSiteContent(key, '');
    setPaths(current => ({ ...current, [key]: '' }));
    if (previousPath.startsWith('branding/')) await supabase.storage.from('site-media').remove([previousPath]);
    setMessage('Uploaded image removed.');
  }

  return (
    <section className="space-y-5">
      <div><h2 className="text-lg font-bold">Brand images</h2><p className="mt-1 text-sm text-gray-400">Logo and favicon entries are managed as uploaded image files. Transparent PNG or SVG files work best.</p></div>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}
      {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading brand images</p> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {logoSettings.map(setting => {
            const path = paths[setting.key];
            const preview = publicUrl(path);
            return (
              <article key={setting.key} className="border border-white/10 bg-white/[0.02] p-5">
                <div className="mb-4"><h3 className="font-bold text-white">{setting.title}</h3><p className="mt-1 text-xs text-gray-400">{setting.description}</p></div>
                <div className="mb-4 flex h-36 items-center justify-center border border-dashed border-white/10 bg-black/20 p-5">
                  {preview ? <img src={preview} alt={`${setting.title} preview`} className="max-h-full max-w-full object-contain" /> : path && /^https?:\/\//i.test(path) ? <p className="text-center text-xs text-amber-200">Legacy URL found. Upload an image file to replace it.</p> : <div className="flex h-14 w-14 items-center justify-center bg-white/5 text-gray-400"><Image size={22} /></div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="flex cursor-pointer items-center gap-2 bg-amber-400 px-3 py-2 text-xs font-bold text-black">
                    {uploading === setting.key ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}{path ? 'Replace image' : 'Upload image'}
                    <input type="file" accept="image/png,image/svg+xml" disabled={uploading !== null} onChange={event => { void uploadLogo(setting.key, event.target.files?.[0]); event.currentTarget.value = ''; }} className="sr-only" />
                  </label>
                  {path && <button type="button" disabled={uploading !== null} onClick={() => void removeLogo(setting.key)} className="flex items-center gap-2 border border-white/10 px-3 py-2 text-xs text-gray-300 hover:border-red-300/30 hover:text-red-200 disabled:opacity-50"><Trash2 size={14} />Remove</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
