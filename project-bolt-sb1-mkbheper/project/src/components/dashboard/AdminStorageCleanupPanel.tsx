import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Category = 'hustles' | 'withdrawals' | 'transactions';
type CleanupCounts = {
  hustles: number;
  withdrawals: number;
  transactions: number;
  task_proofs: number;
  funding_proofs: number;
  proof_bytes: number;
};

const categories: { id: Category; label: string; description: string }[] = [
  { id: 'hustles', label: 'Completed hustles', description: 'Approved or rejected submissions' },
  { id: 'withdrawals', label: 'Withdrawals', description: 'Paid or rejected requests' },
  { id: 'transactions', label: 'Transactions', description: 'Wallet ledger and settled funding records' },
];

function defaultCutoff() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

async function removeStoragePaths(bucket: 'task-proofs' | 'funding-proofs', paths: string[]) {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (error) throw new Error(error.message);
  }
}

export default function AdminStorageCleanupPanel({ onCleaned }: { onCleaned: () => void }) {
  const [open, setOpen] = useState(false);
  const [cutoff, setCutoff] = useState(defaultCutoff);
  const [selected, setSelected] = useState<Record<Category, boolean>>({ hustles: false, withdrawals: false, transactions: false });
  const [preview, setPreview] = useState<CleanupCounts | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function countEligible() {
    if (!cutoff || cutoff >= new Date().toISOString().slice(0, 10)) {
      setMessage('Choose a past cutoff date.');
      return;
    }
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('admin_preview_historical_cleanup', { p_before: cutoff });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setPreview(data as CleanupCounts);
    setConfirmation('');
  }

  async function clearSelected() {
    if (!preview || confirmation !== 'DELETE' || !Object.values(selected).some(Boolean)) return;
    setBusy(true);
    setMessage('');
    try {
      const before = `${cutoff}T00:00:00.000Z`;
      if (selected.hustles) {
        const { data, error } = await supabase.from('task_completions').select('proof_path')
          .in('status', ['approved', 'rejected']).lt('completed_at', before).not('proof_path', 'is', null);
        if (error) throw new Error(error.message);
        await removeStoragePaths('task-proofs', (data ?? []).map(row => row.proof_path).filter((path): path is string => !!path));
      }
      if (selected.transactions) {
        const { data, error } = await supabase.from('funding_deposits').select('proof_path')
          .in('status', ['confirmed', 'rejected', 'expired']).lt('created_at', before).not('proof_path', 'is', null);
        if (error) throw new Error(error.message);
        await removeStoragePaths('funding-proofs', (data ?? []).map(row => row.proof_path).filter((path): path is string => !!path));
      }

      const { data, error } = await supabase.rpc('admin_purge_historical_records', {
        p_before: cutoff,
        p_hustles: selected.hustles,
        p_withdrawals: selected.withdrawals,
        p_transactions: selected.transactions,
      });
      if (error) throw new Error(error.message);
      const deleted = data as Record<string, number>;
      setMessage(`Removed ${deleted.hustles ?? 0} hustles, ${deleted.withdrawals ?? 0} withdrawals, ${deleted.wallet_ledger ?? 0} ledger entries, and ${deleted.funding_deposits ?? 0} funding records.`);
      setPreview(null);
      setConfirmation('');
      onCleaned();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cleanup failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-white/8">
      <button type="button" onClick={() => setOpen(current => !current)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-gray-300 hover:bg-white/5">
        <span className="inline-flex items-center gap-2"><Trash2 size={14} /> Count and clear historical data</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="space-y-4 border-t border-white/8 p-4">
        <p className="text-xs leading-relaxed text-gray-400">Only finalized records before the cutoff are eligible. Pending hustles and withdrawals are never included. Proof files are removed from Storage before their records.</p>
        <label className="block max-w-xs text-xs text-gray-400">Delete records before<input type="date" value={cutoff} max={new Date().toISOString().slice(0, 10)} onChange={event => { setCutoff(event.target.value); setPreview(null); }} className="admin-input mt-1" /></label>
        <div className="grid gap-2 sm:grid-cols-3">
          {categories.map(category => <label key={category.id} className="flex items-start gap-2 border border-white/8 p-3 text-xs text-gray-300"><input type="checkbox" checked={selected[category.id]} onChange={event => { setSelected(current => ({ ...current, [category.id]: event.target.checked })); setPreview(null); setConfirmation(''); }} className="mt-0.5 accent-emerald-400" /><span><strong className="block">{category.label}</strong><span className="mt-1 block text-gray-500">{category.description}</span></span></label>)}
        </div>
        <button type="button" disabled={busy || !Object.values(selected).some(Boolean)} onClick={() => void countEligible()} className="border border-white/10 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-40">{busy ? 'Counting…' : 'Count eligible data'}</button>
        {preview && <div className="space-y-2 border-l-2 border-amber-300 pl-3 text-xs text-gray-300">
          <p>Eligible records: {selected.hustles ? preview.hustles : 0} hustles, {selected.withdrawals ? preview.withdrawals : 0} withdrawals, {selected.transactions ? preview.transactions : 0} transactions.</p>
          <p className="text-gray-500">Associated proof files: {selected.hustles ? preview.task_proofs : 0} hustle, {selected.transactions ? preview.funding_proofs : 0} funding · estimated {((selected.hustles || selected.transactions ? preview.proof_bytes : 0) / (1024 ** 2)).toFixed(2)} MB.</p>
          <label className="block max-w-xs text-gray-400">Type DELETE to permanently remove these records<input value={confirmation} onChange={event => setConfirmation(event.target.value)} className="admin-input mt-1" autoComplete="off" /></label>
          <button type="button" disabled={busy || confirmation !== 'DELETE'} onClick={() => void clearSelected()} className="inline-flex items-center gap-2 bg-red-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Trash2 size={13} />{busy ? 'Removing…' : 'Delete selected history'}</button>
        </div>}
        {message && <p role="status" className="text-xs text-gray-300">{message}</p>}
      </div>}
    </div>
  );
}