WITH categories AS (
  SELECT * FROM (VALUES
    (
      'Telegram Joins',
      'This template illustrates a sponsored Telegram discovery campaign. A brand may fund verified channel growth to reach a relevant community.'
    ),
    (
      'WhatsApp Group Joins',
      'This template illustrates a sponsored WhatsApp community campaign. A brand may fund relevant community growth and customer education.'
    ),
    (
      'Surveys',
      'This template illustrates paid market research. A research sponsor may pay for eligible responses that help evaluate products and customer needs.'
    ),
    (
      'Social Media Engagements',
      'This template illustrates sponsored social engagement. A brand may fund authentic awareness and engagement with approved campaign content.'
    )
  ) AS category_data(category, sponsor_explanation)
), slots AS (
  SELECT generate_series(1, 50) AS slot
)
INSERT INTO public.tasks (
  title,
  description,
  category,
  reward,
  difficulty,
  is_active,
  task_url,
  daily_quota,
  proof_required,
  proof_instructions,
  sort_order
)
SELECT
  'Draft ' || categories.category || ' Campaign ' || lpad(slots.slot::text, 2, '0'),
  'This is draft template ' || slots.slot::text || '. ' ||
  CASE categories.category
    WHEN 'Telegram Joins' THEN (ARRAY[
      'Join the sponsor-approved channel and review its pinned introduction.',
      'Join the partner channel and read the featured campaign announcement.',
      'Follow the authorized Telegram channel and review its current updates.',
      'Join the listed community and read the partner welcome guide.',
      'Visit the approved channel and review the sponsor information post.'
    ])[((slots.slot - 1) % 5) + 1]
    WHEN 'WhatsApp Group Joins' THEN (ARRAY[
      'Join the approved community and read its pinned welcome message.',
      'Join the partner group and review the sponsor-provided community guide.',
      'Open the authorized invite and review the group participation terms.',
      'Join the listed community and read the featured product information.',
      'Review the partner community rules after joining the approved group.'
    ])[((slots.slot - 1) % 5) + 1]
    WHEN 'Surveys' THEN (ARRAY[
      'Complete the sponsor-approved survey with thoughtful, honest answers.',
      'Share your product preferences in the listed market research survey.',
      'Review the research questions and submit one complete response.',
      'Give feedback on the sponsor-provided product concept questionnaire.',
      'Answer the eligibility questions and complete the research form.'
    ])[((slots.slot - 1) % 5) + 1]
    ELSE (ARRAY[
      'Complete the approved campaign follow and keep it active for the stated period.',
      'View the sponsor-approved post and follow the campaign engagement brief.',
      'Share the authorized campaign post with a genuine, relevant audience.',
      'Watch the partner campaign video and follow its stated engagement steps.',
      'Review the brand post and complete the specified social action.'
    ])[((slots.slot - 1) % 5) + 1]
  END || ' ' || categories.sponsor_explanation || ' Before launch, an administrator must add an authorized partner link, precise eligibility terms, and a working verification method. Rewards are payable only for a funded campaign after completion is verified.',
  categories.category,
  CASE
    WHEN slots.slot <= 10 THEN 50
    WHEN slots.slot <= 20 THEN 100
    WHEN slots.slot <= 30 THEN 200
    WHEN slots.slot <= 40 THEN 300
    ELSE 500
  END,
  CASE WHEN slots.slot <= 20 THEN 'Easy' WHEN slots.slot <= 40 THEN 'Medium' ELSE 'Hard' END,
  false,
  '',
  0,
  true,
  'Draft only. Add a campaign-specific authorized URL and sponsor-approved verification instructions before activating this task.',
  floor(random() * 2147483647)::integer
FROM categories
CROSS JOIN slots
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tasks AS existing
  WHERE existing.title = 'Draft ' || categories.category || ' Campaign ' || lpad(slots.slot::text, 2, '0')
    AND existing.category = categories.category
);