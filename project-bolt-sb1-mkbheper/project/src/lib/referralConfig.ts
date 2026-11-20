export const referralTierColors = {
  bronze: {
    label: 'Bronze',
    gradient: 'from-amber-700 to-amber-600',
    border: 'border-amber-700/30',
    glow: 'shadow-amber-700/20',
    badge: 'border-amber-700/30',
  },
  silver: {
    label: 'Silver',
    gradient: 'from-gray-400 to-gray-300',
    border: 'border-gray-400/30',
    glow: 'shadow-gray-400/20',
    badge: 'border-gray-400/30',
  },
  gold: {
    label: 'Gold',
    gradient: 'from-amber-400 to-yellow-300',
    border: 'border-amber-400/40',
    glow: 'shadow-amber-400/30',
    badge: 'border-amber-400/30',
  },
  blue: {
    label: 'Blue',
    gradient: 'from-blue-400 to-cyan-300',
    border: 'border-blue-400/30',
    glow: 'shadow-blue-400/20',
    badge: 'border-blue-400/30',
  },
  emerald: {
    label: 'Emerald',
    gradient: 'from-emerald-400 to-green-300',
    border: 'border-emerald-400/30',
    glow: 'shadow-emerald-400/20',
    badge: 'border-emerald-400/30',
  },
  purple: {
    label: 'Purple',
    gradient: 'from-violet-400 to-purple-300',
    border: 'border-violet-400/30',
    glow: 'shadow-violet-400/20',
    badge: 'border-violet-400/30',
  },
} as const;

export type ReferralTierColor = keyof typeof referralTierColors;

export type ReferralTier = {
  id: string;
  name: string;
  minReferrals: number;
  maxReferrals: number | null;
  rewardLabel: string;
  benefits: string;
  color: ReferralTierColor;
  popular: boolean;
};

export type ReferralConfig = {
  stepsTitle: string;
  tiersTitle: string;
  steps: string[];
  tiers: ReferralTier[];
};

export const referralConfigKey = 'referrals.configuration';
export const legacyReferralStepKeys = [
  'referrals.how_it_works.1',
  'referrals.how_it_works.2',
  'referrals.how_it_works.3',
  'referrals.how_it_works.4',
];

export const defaultReferralConfig: ReferralConfig = {
  stepsTitle: 'How Referrals Work',
  tiersTitle: 'Referral Reward Tiers',
  steps: [
    'Copy and share your unique referral link via WhatsApp, social media, or anywhere.',
    'Your friend signs up using your link and creates a verified account.',
    'When they complete their first hustle, you receive the configured referral bonus.',
    'You continue earning referral rewards as your invite completes hustles.',
  ],
  tiers: [
    { id: 'bronze', name: 'Bronze', minReferrals: 1, maxReferrals: 4, rewardLabel: 'Standard Bonus', benefits: 'Access to basic referral dashboard', color: 'bronze', popular: false },
    { id: 'silver', name: 'Silver', minReferrals: 5, maxReferrals: 19, rewardLabel: 'Enhanced Bonus', benefits: 'Leaderboard visibility', color: 'silver', popular: false },
    { id: 'gold', name: 'Gold', minReferrals: 20, maxReferrals: 49, rewardLabel: 'Premium Bonus', benefits: 'Priority hustle access', color: 'gold', popular: true },
    { id: 'platinum', name: 'Platinum', minReferrals: 50, maxReferrals: null, rewardLabel: 'Maximum Bonus', benefits: 'Exclusive VIP rewards', color: 'blue', popular: false },
  ],
};

function isReferralTierColor(value: unknown): value is ReferralTierColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(referralTierColors, value);
}

export function parseReferralConfig(value?: string, legacySteps: (string | undefined)[] = []): ReferralConfig {
  if (!value) {
    const savedSteps = legacySteps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0).map(step => step.trim());
    return savedSteps.length ? { ...defaultReferralConfig, steps: savedSteps } : defaultReferralConfig;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return defaultReferralConfig;
    const config = parsed as Record<string, unknown>;
    const steps = Array.isArray(config.steps)
      ? config.steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0).map(step => step.trim().slice(0, 500))
      : defaultReferralConfig.steps;
    const tiers = Array.isArray(config.tiers)
      ? config.tiers.flatMap((item, index): ReferralTier[] => {
        if (!item || typeof item !== 'object') return [];
        const tier = item as Record<string, unknown>;
        const minReferrals = Number(tier.minReferrals);
        const maxReferrals = tier.maxReferrals === null ? null : Number(tier.maxReferrals);
        if (
          !Number.isInteger(minReferrals) || minReferrals < 1
          || (maxReferrals !== null && (!Number.isInteger(maxReferrals) || maxReferrals < minReferrals))
          || !isReferralTierColor(tier.color)
        ) return [];
        return [{
          id: typeof tier.id === 'string' && tier.id ? tier.id.slice(0, 100) : `tier-${index + 1}`,
          name: typeof tier.name === 'string' ? tier.name.trim().slice(0, 60) : '',
          minReferrals,
          maxReferrals,
          rewardLabel: typeof tier.rewardLabel === 'string' ? tier.rewardLabel.trim().slice(0, 100) : '',
          benefits: typeof tier.benefits === 'string' ? tier.benefits.trim().slice(0, 300) : '',
          color: tier.color,
          popular: tier.popular === true,
        }];
      })
      : defaultReferralConfig.tiers;

    return {
      stepsTitle: typeof config.stepsTitle === 'string' && config.stepsTitle.trim() ? config.stepsTitle.trim().slice(0, 100) : defaultReferralConfig.stepsTitle,
      tiersTitle: typeof config.tiersTitle === 'string' && config.tiersTitle.trim() ? config.tiersTitle.trim().slice(0, 100) : defaultReferralConfig.tiersTitle,
      steps: steps.length ? steps : defaultReferralConfig.steps,
      tiers: tiers.length ? tiers : defaultReferralConfig.tiers,
    };
  } catch {
    return defaultReferralConfig;
  }
}

export function formatReferralRange(tier: ReferralTier) {
  return `${tier.minReferrals}${tier.maxReferrals === null ? '+' : `–${tier.maxReferrals}`} referrals`;
}
