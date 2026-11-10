import { useEffect, useState } from 'react';
import { Crown, Loader2, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Category = 'earnings' | 'hustles' | 'referrals';
type Entry = { position: number; user_id: string | null; display_name: string; avatar_url: string | null; score: number };
const categories: { id: Category; label: string }[] = [
  { id: 'earnings', label: 'Earnings' },
  { id: 'hustles', label: 'Completed hustles' },
  { id: 'referrals', label: 'Referrals' },
];

export default function LeaderboardPanel({ userId }: { userId: string }) {
  const [category, setCategory] = useState<Category>('earnings');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hustleScore, setHustleScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      const [{ data, error: listError }, { data: score, error: scoreError }] = await Promise.all([
        supabase.rpc('get_leaderboard', { p_category: category }),
        supabase.rpc('get_hustle_score', { p_user_id: userId }),
      ]);
      if (!active) return;
      if (listError || scoreError) setError(listError?.message ?? scoreError?.message ?? 'Could not load leaderboard.');
      setEntries((data ?? []) as Entry[]);
      setHustleScore(typeof score === 'number' ? score : null);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [category, userId]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div><p className="text-xs font-bold uppercase text-orange-300">Top 20</p><h2 className="mt-1 text-xl font-black">Hustler leaderboard</h2></div>
        <p className="text-sm text-gray-400">Your Hustle Score <strong className="ml-1 text-white">{hustleScore === null ? '—' : `${hustleScore}/100`}</strong></p>
      </div>
      <nav className="flex gap-2 border-b border-white/10" aria-label="Leaderboard ranking">
        {categories.map(item => <button key={item.id} onClick={() => setCategory(item.id)} aria-pressed={category === item.id} className={`border-b-2 px-3 py-2 text-xs font-semibold sm:text-sm ${category === item.id ? 'border-orange-400 text-orange-200' : 'border-transparent text-gray-400 hover:text-white'}`}>{item.label}</button>)}
      </nav>
      {error && <p role="alert" className="border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading ? <div className="flex min-h-40 items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin" size={17} /> Loading leaderboard</div> : (
        <ol className="divide-y divide-white/8 border-y border-white/8">
          {entries.map(entry => (
            <li key={entry.position} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3 sm:grid-cols-[2.5rem_2.25rem_minmax(0,1fr)_auto]">
              <span className={`flex h-8 w-8 items-center justify-center text-xs font-black ${entry.position <= 3 ? 'bg-orange-300/15 text-orange-200' : 'bg-white/5 text-gray-400'}`}>{entry.position <= 3 ? <Crown size={15} /> : entry.position}</span>
              {entry.avatar_url ? <img src={entry.avatar_url} alt="" className="hidden h-9 w-9 rounded-full object-cover sm:block" /> : <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-white/5 text-xs text-gray-500 sm:flex"><Trophy size={14} /></div>}
              <span className="min-w-0 truncate text-sm font-semibold text-white">{entry.display_name}</span>
              <span className="text-sm font-bold text-orange-200">{category === 'earnings' ? `₦${Number(entry.score).toLocaleString('en-NG')}` : Number(entry.score).toLocaleString('en-NG')}</span>
            </li>
          ))}
          {entries.length === 0 && <li className="py-10 text-center text-sm text-gray-500">No rankings yet.</li>}
        </ol>
      )}
      <p className="text-xs text-gray-500">Names and profile photos appear only when the user has enabled public activity.</p>
    </section>
  );
}
