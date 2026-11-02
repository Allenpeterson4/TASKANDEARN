/*
# MrHustler Dashboard Tables

## Summary
Creates all backend tables needed for the member dashboard:
- `profiles` – stores each user's display name, avatar URL, referral code, tier, and account status
- `balances` – one row per user tracking reward balance and referral balance
- `tasks` – catalogue of available tasks with category, reward, and difficulty
- `task_completions` – records which tasks a user has completed
- `referrals` – tracks who referred whom and whether the bonus was paid
- `withdrawals` – withdrawal requests with bank details, amount, and status

## Security
- RLS enabled on every table
- Authenticated users own their own rows (auth.uid() = user_id)
- `tasks` table is readable by everyone (anon + authenticated) since it is a public catalogue
- Owner defaults set via DEFAULT auth.uid() so inserts never need to pass user_id explicitly
*/

-- ─── profiles ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  username   text NOT NULL DEFAULT '',
  full_name  text NOT NULL DEFAULT '',
  avatar_url text,
  phone      text,
  tier       text NOT NULL DEFAULT 'Bronze',
  referral_code text UNIQUE,
  joined_at  timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;

DROP POLICY IF EXISTS "select_own_profile"  ON profiles;
DROP POLICY IF EXISTS "insert_own_profile"  ON profiles;
DROP POLICY IF EXISTS "update_own_profile"  ON profiles;

CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ─── balances ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS balances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_balance   numeric(12,2) NOT NULL DEFAULT 0,
  referral_balance numeric(12,2) NOT NULL DEFAULT 0,
  total_earned     numeric(12,2) NOT NULL DEFAULT 0,
  updated_at       timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON balances TO authenticated;

DROP POLICY IF EXISTS "select_own_balance"  ON balances;
DROP POLICY IF EXISTS "insert_own_balance"  ON balances;
DROP POLICY IF EXISTS "update_own_balance"  ON balances;

CREATE POLICY "select_own_balance" ON balances FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_balance" ON balances FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_balance" ON balances FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ─── tasks ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'General',
  reward      numeric(10,2) NOT NULL DEFAULT 0,
  difficulty  text NOT NULL DEFAULT 'Easy',
  is_active   boolean NOT NULL DEFAULT true,
  expires_at  timestamptz,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON tasks TO anon, authenticated;

DROP POLICY IF EXISTS "anyone_select_tasks" ON tasks;
CREATE POLICY "anyone_select_tasks" ON tasks FOR SELECT
  TO anon, authenticated USING (true);


-- ─── task_completions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_completions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',
  completed_at timestamptz DEFAULT now(),
  UNIQUE(user_id, task_id)
);

ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON task_completions TO authenticated;

DROP POLICY IF EXISTS "select_own_completions" ON task_completions;
DROP POLICY IF EXISTS "insert_own_completions" ON task_completions;

CREATE POLICY "select_own_completions" ON task_completions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_completions" ON task_completions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);


-- ─── referrals ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bonus_paid     boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now(),
  UNIQUE(referred_id)
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON referrals TO authenticated;

DROP POLICY IF EXISTS "select_own_referrals" ON referrals;
DROP POLICY IF EXISTS "insert_own_referrals" ON referrals;

CREATE POLICY "select_own_referrals" ON referrals FOR SELECT
  TO authenticated USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

CREATE POLICY "insert_own_referrals" ON referrals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = referred_id);


-- ─── withdrawals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL,
  bank_name    text NOT NULL DEFAULT '',
  account_no   text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'pending',
  requested_at timestamptz DEFAULT now()
);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON withdrawals TO authenticated;

DROP POLICY IF EXISTS "select_own_withdrawals" ON withdrawals;
DROP POLICY IF EXISTS "insert_own_withdrawals" ON withdrawals;

CREATE POLICY "select_own_withdrawals" ON withdrawals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_withdrawals" ON withdrawals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);


-- ─── seed tasks ──────────────────────────────────────────────────────────────
INSERT INTO tasks (title, description, category, reward, difficulty) VALUES
  ('Follow Us on Instagram',   'Follow @mrhustlerhq on Instagram and keep the follow active for 7 days.',        'Social Media', 250,   'Easy'),
  ('Share Our Facebook Post',  'Share our latest pinned post on Facebook to your timeline.',                     'Social Media', 200,   'Easy'),
  ('Subscribe on YouTube',     'Subscribe to our YouTube channel and watch any one video.',                      'Social Media', 300,   'Easy'),
  ('Complete Survey #1',       'Answer a short 10-question survey about online earning habits.',                  'Survey',       500,   'Easy'),
  ('Product Review Task',      'Write a genuine 3-sentence review for a listed product on our partner site.',    'Review',       700,   'Medium'),
  ('App Download & Register',  'Download the partner app, register an account, and verify your email.',          'App Install',  800,   'Medium'),
  ('Data Entry Batch A',       'Enter 50 records into a provided spreadsheet template accurately.',               'Data Entry',   1200,  'Medium'),
  ('Video Watch & Comment',    'Watch a 2-minute video and leave a meaningful comment under it.',                'Video',        350,   'Easy'),
  ('Refer 1 Active Friend',    'Refer a friend who completes at least one task within 7 days of signing up.',    'Referral',     1500,  'Hard'),
  ('Website Sign-up Task',     'Register on our partner website using your real details and confirm your email.','Sign-up',      600,   'Easy'),
  ('Complete Survey #2',       'Answer a detailed 15-question market research survey.',                          'Survey',       750,   'Medium'),
  ('Twitter/X Follow & RT',    'Follow @MrHustlerNG on X and retweet our latest pinned post.',                   'Social Media', 280,   'Easy')
ON CONFLICT DO NOTHING;
