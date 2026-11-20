INSERT INTO public.site_content (content_key, title, body)
VALUES (
  'referrals.configuration',
  'Referral configuration',
  jsonb_build_object(
    'stepsTitle', 'How Referrals Work',
    'tiersTitle', 'Referral Reward Tiers',
    'steps', jsonb_build_array(
      COALESCE((SELECT body FROM public.site_content WHERE content_key = 'referrals.how_it_works.1'), 'Copy and share your unique referral link via WhatsApp, social media, or anywhere.'),
      COALESCE((SELECT body FROM public.site_content WHERE content_key = 'referrals.how_it_works.2'), 'Your friend signs up using your link and creates a verified account.'),
      COALESCE((SELECT body FROM public.site_content WHERE content_key = 'referrals.how_it_works.3'), 'When they complete their first hustle, you receive the configured referral bonus.'),
      COALESCE((SELECT body FROM public.site_content WHERE content_key = 'referrals.how_it_works.4'), 'You continue earning referral rewards as your invite completes hustles.')
    ),
    'tiers', jsonb_build_array(
      jsonb_build_object('id', 'bronze', 'name', 'Bronze', 'minReferrals', 1, 'maxReferrals', 4, 'rewardLabel', 'Standard Bonus', 'benefits', 'Access to basic referral dashboard', 'color', 'bronze', 'popular', false),
      jsonb_build_object('id', 'silver', 'name', 'Silver', 'minReferrals', 5, 'maxReferrals', 19, 'rewardLabel', 'Enhanced Bonus', 'benefits', 'Leaderboard visibility', 'color', 'silver', 'popular', false),
      jsonb_build_object('id', 'gold', 'name', 'Gold', 'minReferrals', 20, 'maxReferrals', 49, 'rewardLabel', 'Premium Bonus', 'benefits', 'Priority hustle access', 'color', 'gold', 'popular', true),
      jsonb_build_object('id', 'platinum', 'name', 'Platinum', 'minReferrals', 50, 'maxReferrals', NULL, 'rewardLabel', 'Maximum Bonus', 'benefits', 'Exclusive VIP rewards', 'color', 'blue', 'popular', false)
    )
  )::text
)
ON CONFLICT (content_key) DO NOTHING;
