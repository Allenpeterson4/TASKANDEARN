import { useState } from 'react';
import { User, Phone, Mail, Save, Loader2, CheckCircle, Camera, Lock, Eye, EyeOff } from 'lucide-react';
import type { Profile } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

interface Props {
  profile: Profile | null;
  email: string;
  onProfileUpdated: (p: Profile) => void;
}

export default function ProfilePanel({ profile, email, onProfileUpdated }: Props) {
  const [form, setForm] = useState({
    full_name: profile?.full_name ?? '',
    username: profile?.username ?? '',
    phone: profile?.phone ?? '',
  });
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [msg, setMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [publicPayoutOptIn, setPublicPayoutOptIn] = useState(profile?.public_activity_opt_in ?? false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  const setPw = (k: keyof typeof pwForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPwForm(prev => ({ ...prev, [k]: e.target.value }));

  const initials = form.full_name
    ? form.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'MH';

  const tierColors: Record<string, string> = {
    Bronze:   'from-amber-700 to-amber-600',
    Silver:   'from-gray-400 to-gray-300',
    Gold:     'from-amber-400 to-yellow-300',
    Platinum: 'from-blue-400 to-cyan-300',
  };
  const tc = tierColors[profile?.tier ?? 'Bronze'] ?? tierColors.Bronze;

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!profile?.user_id) return setMsg('Your profile is not ready yet.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setMsg('Choose a PNG, JPEG, or WebP image smaller than 2 MB.');
      return;
    }

    setUploadingAvatar(true);
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${profile.user_id}/avatar-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('member-avatars').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      setUploadingAvatar(false);
      setMsg(uploadError.message);
      return;
    }

    const { data: publicUrl } = supabase.storage.from('member-avatars').getPublicUrl(path);
    const { data, error } = await supabase.from('profiles')
      .update({ avatar_url: publicUrl.publicUrl })
      .eq('user_id', profile.user_id)
      .select()
      .single();
    setUploadingAvatar(false);
    if (error) {
      await supabase.storage.from('member-avatars').remove([path]);
      setMsg(error.message);
      return;
    }
    onProfileUpdated(data as Profile);
    setMsg('Profile photo updated.');
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: form.full_name,
          username: form.username,
          phone: form.phone,
          public_activity_opt_in: publicPayoutOptIn,
        })
        .eq('user_id', profile?.user_id)
        .select()
        .single();
      if (error) throw error;
      onProfileUpdated(data as Profile);
      setMsg('Profile updated successfully.');
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 4000);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg('');
    if (pwForm.next !== pwForm.confirm) return setPwMsg('Passwords do not match.');
    if (pwForm.next.length < 6) return setPwMsg('Password must be at least 6 characters.');
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwForm.next });
      if (error) throw error;
      setPwMsg('Password changed successfully.');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err: unknown) {
      setPwMsg(err instanceof Error ? err.message : 'Password change failed.');
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwMsg(''), 4000);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Avatar + tier */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-6 flex items-center gap-5">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400/30 to-orange-600/30 border-2 border-amber-400/20 flex items-center justify-center">
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt="Profile avatar" className="h-full w-full rounded-[inherit] object-cover" />
              : <span className="text-amber-400 font-black text-2xl">{initials}</span>}
          </div>
          <label className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-amber-400 shadow-lg transition-colors hover:bg-amber-300" title="Upload profile photo">
            {uploadingAvatar ? <Loader2 size={13} className="animate-spin text-black" /> : <Camera size={13} className="text-black" />}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadAvatar} disabled={uploadingAvatar} className="sr-only" />
          </label>
        </div>
        <div>
          <h2 className="text-white font-black text-xl">{form.full_name || 'Your Name'}</h2>
          <p className="text-gray-400 text-sm mt-0.5">@{form.username || 'username'}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-black bg-gradient-to-r ${tc} text-black`}>
              {profile?.tier ?? 'Bronze'} Member
            </span>
            {profile?.referral_code && (
              <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 text-gray-300 border border-white/8">
                Code: {profile.referral_code}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center">
            <User size={15} className="text-amber-400" />
          </div>
          <p className="text-white font-bold text-sm">Personal Information</p>
        </div>

        <form onSubmit={saveProfile} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Full Name</label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={form.full_name}
                  onChange={set('full_name')}
                  placeholder="Full Name"
                  className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Username</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">@</span>
                <input
                  type="text"
                  value={form.username}
                  onChange={set('username')}
                  placeholder="username"
                  className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-8 pr-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Email Address</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="email"
                value={email}
                disabled
                className="w-full bg-[#0a0a0a] border border-white/5 rounded-xl pl-10 pr-4 py-3 text-gray-500 text-sm cursor-not-allowed"
              />
            </div>
            <p className="text-gray-600 text-xs mt-1">Email cannot be changed.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Phone Number</label>
            <div className="relative">
              <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="tel"
                value={form.phone}
                onChange={set('phone')}
                placeholder="080XXXXXXXX"
                className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-400/50 transition-colors"
              />
            </div>
          </div>

          <label className="flex items-start gap-3 border border-white/8 p-3 text-sm text-gray-300">
            <input type="checkbox" checked={publicPayoutOptIn} onChange={event => setPublicPayoutOptIn(event.target.checked)} className="mt-0.5 accent-amber-400" />
            <span>Allow my completed payouts to appear in the public activity feed with my name masked. This is optional and can be changed anytime.</span>
          </label>

          {msg && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm border ${
              msg.includes('success') || msg.includes('successfully')
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              <CheckCircle size={14} />
              {msg}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm hover:shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save Changes
          </button>
        </form>
      </div>

      {/* Password change */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-blue-400/10 flex items-center justify-center">
            <Lock size={15} className="text-blue-400" />
          </div>
          <p className="text-white font-bold text-sm">Change Password</p>
        </div>

        <form onSubmit={changePassword} className="space-y-4">
          {(['next', 'confirm'] as const).map(key => (
            <div key={key}>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium capitalize">
                {key === 'next' ? 'New Password' : 'Confirm New Password'}
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwForm[key]}
                  onChange={setPw(key)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  className="w-full bg-[#0a0a0a] border border-white/8 rounded-xl pl-10 pr-10 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-400/50 transition-colors"
                />
                {key === 'next' && (
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {pwMsg && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm border ${
              pwMsg.includes('success')
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              <CheckCircle size={14} />
              {pwMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={savingPw}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 font-bold text-sm border border-blue-500/20 transition-all disabled:opacity-60"
          >
            {savingPw ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
            Update Password
          </button>
        </form>
      </div>

      {/* Account info */}
      <div className="bg-[#111] border border-white/6 rounded-2xl p-5">
        <h3 className="text-white font-bold text-sm mb-4">Account Details</h3>
        <div className="space-y-3">
          {[
            { label: 'Member Since', value: profile?.joined_at ? new Date(profile.joined_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
            { label: 'Account Tier', value: profile?.tier ?? 'Bronze' },
            { label: 'Referral Code', value: profile?.referral_code ?? '—' },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between py-2 border-b border-white/4 last:border-0">
              <span className="text-gray-400 text-sm">{row.label}</span>
              <span className="text-white text-sm font-semibold">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
