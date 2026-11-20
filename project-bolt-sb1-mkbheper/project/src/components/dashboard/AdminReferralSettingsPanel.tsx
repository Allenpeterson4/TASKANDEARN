import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { cacheSiteContent } from '@/hooks/useSiteContent';
import { mysqlApi } from '@/lib/platformTypes';
import {
  defaultReferralConfig,
  formatReferralRange,
  legacyReferralStepKeys,
  parseReferralConfig,
  referralConfigKey,
  referralTierColors,
  type ReferralConfig,
  type ReferralTier,
  type ReferralTierColor,
} from '@/lib/referralConfig';

const maxEntries = 20;

function validateConfig(config: ReferralConfig) {
  if (!config.stepsTitle.trim() || !config.tiersTitle.trim()) return 'Enter both section headings.';
  if (config.steps.length === 0 || config.steps.length > maxEntries || config.steps.some(step => !step.trim())) {
    return `Add between 1 and ${maxEntries} non-empty referral steps.`;
  }
  if (config.tiers.length === 0 || config.tiers.length > maxEntries) {
    return `Add between 1 and ${maxEntries} referral tiers.`;
  }

  const names = new Set<string>();
  const tiers = [...config.tiers].sort((left, right) => left.minReferrals - right.minReferrals);
  let previousMax = 0;
  for (const tier of tiers) {
    const name = tier.name.trim().toLowerCase();
    if (!name || names.has(name)) return 'Tier names must be non-empty and unique.';
    names.add(name);
    if (!Number.isInteger(tier.minReferrals) || tier.minReferrals < 1) return 'Tier minimum referrals must be a whole number greater than zero.';
    if (tier.maxReferrals !== null && (!Number.isInteger(tier.maxReferrals) || tier.maxReferrals < tier.minReferrals)) {
      return `The maximum for ${tier.name} must be at least its minimum, or left blank for no limit.`;
    }
    if (tier.minReferrals <= previousMax) return 'Referral tier ranges cannot overlap.';
    if (previousMax === Infinity) return 'Only the last tier can have no maximum.';
    previousMax = tier.maxReferrals ?? Infinity;
  }
  return '';
}

export default function AdminReferralSettingsPanel() {
  const [config, setConfig] = useState<ReferralConfig>(defaultReferralConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    mysqlApi.from('site_content').select('content_key, body').in('content_key', [referralConfigKey, ...legacyReferralStepKeys]).then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      const entries = new Map<string, string>((data ?? []).map((entry: { content_key: string; body: string }) => [entry.content_key, entry.body]));
      setConfig(parseReferralConfig(entries.get(referralConfigKey), legacyReferralStepKeys.map(key => entries.get(key))));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function updateConfig(update: Partial<ReferralConfig>) {
    setConfig(current => ({ ...current, ...update }));
  }

  function updateTier(id: string, update: Partial<ReferralTier>) {
    setConfig(current => ({ ...current, tiers: current.tiers.map(tier => tier.id === id ? { ...tier, ...update } : tier) }));
  }

  function addStep() {
    if (config.steps.length >= maxEntries) {
      setMessage(`You can add up to ${maxEntries} steps.`);
      return;
    }
    updateConfig({ steps: [...config.steps, 'New referral step'] });
  }

  function moveStep(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= config.steps.length) return;
    const steps = [...config.steps];
    [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
    updateConfig({ steps });
  }

  function addTier() {
    if (config.tiers.length >= maxEntries) {
      setMessage(`You can add up to ${maxEntries} tiers.`);
      return;
    }
    const ordered = [...config.tiers].sort((left, right) => left.minReferrals - right.minReferrals);
    const last = ordered[ordered.length - 1];
    const extendsUnlimitedTier = last?.maxReferrals === null;
    const minReferrals = last ? (last.maxReferrals ?? last.minReferrals + 9) + 1 : 1;
    const updatedTiers = config.tiers.map(tier => tier.id === last?.id && tier.maxReferrals === null
      ? { ...tier, maxReferrals: minReferrals - 1 }
      : tier);
    const tier: ReferralTier = {
      id: crypto.randomUUID(),
      name: `Tier ${config.tiers.length + 1}`,
      minReferrals,
      maxReferrals: extendsUnlimitedTier ? null : minReferrals + 9,
      rewardLabel: '',
      benefits: '',
      color: 'gold',
      popular: false,
    };
    updateConfig({ tiers: [...updatedTiers, tier] });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    const validationError = validateConfig(config);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setSaving(true);
    const user = await mysqlApi.auth.getCurrentUser();
    const orderedConfig = {
      ...config,
      steps: config.steps.map(step => step.trim()),
      tiers: [...config.tiers].sort((left, right) => left.minReferrals - right.minReferrals),
    };
    const body = JSON.stringify(orderedConfig);
    const { error } = await mysqlApi.from('site_content').upsert({
      content_key: referralConfigKey,
      title: 'Referral configuration',
      body,
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'content_key' });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    updateConfig(orderedConfig);
    cacheSiteContent(referralConfigKey, body);
    setMessage('Referral content saved and published.');
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <header className="border-b border-white/10 pb-4">
        <h2 className="text-lg font-bold">Referral content</h2>
        <p className="mt-1 text-sm text-gray-400">Edit the referral instructions and tier cards shown on the public site and member dashboard.</p>
      </header>
      {message && <p role="status" className="border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">{message}</p>}
      {loading ? <p className="py-10 text-center text-sm text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={15} />Loading referral content</p> : <>
        <section className="space-y-4">
          <label className="block text-xs text-gray-400">Instructions heading<input required maxLength={100} value={config.stepsTitle} onChange={event => updateConfig({ stepsTitle: event.target.value })} className="admin-input mt-1" /></label>
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">How Referrals Work steps</h3>
            {config.steps.map((step, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="mt-3 w-7 shrink-0 text-center text-xs font-bold text-amber-300">{index + 1}</span>
                <textarea maxLength={500} rows={2} value={step} onChange={event => updateConfig({ steps: config.steps.map((current, row) => row === index ? event.target.value : current) })} className="admin-input resize-y" aria-label={`Referral step ${index + 1}`} />
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label={`Move step ${index + 1} up`} className="border border-white/10 p-1.5 text-gray-400 disabled:opacity-30"><ArrowUp size={13} /></button>
                  <button type="button" disabled={index === config.steps.length - 1} onClick={() => moveStep(index, 1)} aria-label={`Move step ${index + 1} down`} className="border border-white/10 p-1.5 text-gray-400 disabled:opacity-30"><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => updateConfig({ steps: config.steps.filter((_, row) => row !== index) })} aria-label={`Remove step ${index + 1}`} className="border border-white/10 p-1.5 text-gray-400 hover:text-red-300"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addStep} className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5"><Plus size={14} />Add step</button>
          </div>
        </section>

        <section className="space-y-4 border-t border-white/10 pt-5">
          <label className="block text-xs text-gray-400">Tier section heading<input required maxLength={100} value={config.tiersTitle} onChange={event => updateConfig({ tiersTitle: event.target.value })} className="admin-input mt-1" /></label>
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">Referral tiers</h3>
            {config.tiers.map((tier, index) => (
              <article key={tier.id} className="space-y-3 border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div><h4 className="text-sm font-bold text-white">{tier.name || `Tier ${index + 1}`}</h4><p className="mt-1 text-xs text-gray-500">{formatReferralRange(tier)}</p></div>
                  <button type="button" onClick={() => updateConfig({ tiers: config.tiers.filter(item => item.id !== tier.id) })} aria-label={`Remove ${tier.name || `tier ${index + 1}`}`} className="border border-white/10 p-2 text-gray-400 hover:text-red-300"><Trash2 size={15} /></button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs text-gray-400">Tier name<input required maxLength={60} value={tier.name} onChange={event => updateTier(tier.id, { name: event.target.value })} className="admin-input mt-1" /></label>
                  <label className="text-xs text-gray-400">Minimum referrals<input required type="number" min="1" step="1" value={tier.minReferrals} onChange={event => updateTier(tier.id, { minReferrals: Number(event.target.value) })} className="admin-input mt-1" /></label>
                  <label className="text-xs text-gray-400">Maximum referrals (blank = unlimited)<input type="number" min={tier.minReferrals} step="1" value={tier.maxReferrals ?? ''} onChange={event => updateTier(tier.id, { maxReferrals: event.target.value === '' ? null : Number(event.target.value) })} className="admin-input mt-1" /></label>
                  <label className="text-xs text-gray-400">Reward headline<input maxLength={100} value={tier.rewardLabel} onChange={event => updateTier(tier.id, { rewardLabel: event.target.value })} className="admin-input mt-1" /></label>
                  <label className="text-xs text-gray-400">Tier benefits<input maxLength={300} value={tier.benefits} onChange={event => updateTier(tier.id, { benefits: event.target.value })} className="admin-input mt-1" /></label>
                  <label className="text-xs text-gray-400">Badge color<select value={tier.color} onChange={event => updateTier(tier.id, { color: event.target.value as ReferralTierColor })} className="admin-input mt-1">{Object.entries(referralTierColors).map(([color, style]) => <option key={color} value={color}>{style.label}</option>)}</select></label>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={tier.popular} onChange={event => updateTier(tier.id, { popular: event.target.checked })} className="accent-amber-400" />Show “Most Popular” badge</label>
              </article>
            ))}
            <button type="button" onClick={addTier} className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/5"><Plus size={14} />Add tier</button>
          </div>
        </section>
        <button disabled={saving} className="inline-flex items-center gap-2 bg-amber-400 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}Save and publish</button>
      </>}
      <style>{`.admin-input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(251,191,36,.55)}`}</style>
    </form>
  );
}
