import { useEffect, useState } from 'react';
import { Image, Loader2, Save, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Advertisement = { image_path: string | null; target_url: string | null; enabled: boolean };
const initial: Advertisement = { image_path: null, target_url: '', enabled: false };

export default function AdminAdBannerPanel() {
  const [advertisement, setAdvertisement] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [filePreview, setFilePreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    supabase.from('dashboard_advertisements').select('image_path, target_url, enabled').eq('singleton', true).maybeSingle()
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        if (data) setAdvertisement(data as Advertisement);
        setLoading(false);
      });
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!file && !advertisement.image_path) return setMessage('Upload an advertisement image first.');
    if (!advertisement.target_url || !/^https?:\/\//i.test(advertisement.target_url)) return setMessage('Enter a full HTTPS or HTTP destination URL.');
    setSaving(true);
    let imagePath = advertisement.image_path;
    if (file) {
      const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      const { error } = await supabase.storage.from('dashboard-ads').upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        setSaving(false);
        setMessage(error.message);
        return;
      }
      imagePath = path;
    }
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from('dashboard_advertisements').upsert({ singleton: true, image_path: imagePath, target_url: advertisement.target_url.trim(), enabled: advertisement.enabled, updated_by: user.user?.id, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setAdvertisement(current => ({ ...current, image_path: imagePath }));
    setFile(null);
    setMessage('Dashboard advertisement saved.');
  }

  const previewPath = filePreview ?? (advertisement.image_path ? supabase.storage.from('dashboard-ads').getPublicUrl(advertisement.image_path).data.publicUrl : '');

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <p className="max-w-2xl text-sm text-gray-400">Upload a dashboard banner and set its destination. Only administrators can change the published banner.</p>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}
      {loading ? <p className="py-8 text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading banner</p> : <>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-white/15 bg-white/[0.02] px-4 text-sm text-gray-400 hover:border-amber-300/40">
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}Choose PNG, JPEG, or WebP (up to 10 MB)
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {previewPath && <div className="overflow-hidden border border-white/10"><img src={previewPath} alt="Advertisement preview" className="max-h-48 w-full object-contain" /></div>}
        <label className="block text-xs text-gray-400">Target link<input type="url" required value={advertisement.target_url ?? ''} onChange={event => setAdvertisement({ ...advertisement, target_url: event.target.value })} placeholder="https://example.com" className="admin-input mt-1" /></label>
        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={advertisement.enabled} onChange={event => setAdvertisement({ ...advertisement, enabled: event.target.checked })} className="accent-amber-400" />Publish on dashboard</label>
        <button disabled={saving} className="flex items-center gap-2 bg-amber-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={15} /> : previewPath ? <Save size={15} /> : <Image size={15} />}Save banner</button>
      </>}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}`}</style>
    </form>
  );
}
