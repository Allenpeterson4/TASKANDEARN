SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  email_verified_at DATETIME(3) NULL,
  account_status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY users_email_unique (email),
  CHECK (role IN ('member', 'admin')),
  CHECK (account_status IN ('active', 'suspended', 'banned'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  mfa_verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY auth_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT auth_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_action_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  purpose VARCHAR(30) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY auth_action_tokens_user_purpose (user_id, purpose, expires_at),
  CONSTRAINT auth_action_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (purpose IN ('verify_email', 'password_reset'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_mfa_factors (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY admin_mfa_user_unique (user_id),
  CONSTRAINT admin_mfa_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  username VARCHAR(60) NOT NULL DEFAULT '',
  full_name VARCHAR(160) NOT NULL DEFAULT '',
  avatar_url TEXT NULL,
  phone VARCHAR(40) NULL,
  tier VARCHAR(40) NOT NULL DEFAULT 'Bronze',
  referral_code VARCHAR(40) NULL,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  account_status VARCHAR(20) NOT NULL DEFAULT 'active',
  status_reason TEXT NULL,
  status_changed_at DATETIME(3) NULL,
  status_changed_by CHAR(36) NULL,
  public_activity_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  leaderboard_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY profiles_user_unique (user_id),
  UNIQUE KEY profiles_referral_code_unique (referral_code),
  CONSTRAINT profiles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT profiles_status_by_fk FOREIGN KEY (status_changed_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (account_status IN ('active', 'suspended', 'banned'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS balances (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  reward_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  referral_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  fund_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_earned DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY balances_user_unique (user_id),
  CONSTRAINT balances_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (reward_balance >= 0 AND referral_balance >= 0 AND fund_balance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_code VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  daily_task_limit INT NOT NULL,
  daily_earning_cap DECIMAL(12,2) NULL,
  max_withdrawal DECIMAL(12,2) NOT NULL DEFAULT 500,
  referral_commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CHECK (price >= 0 AND daily_task_limit > 0 AND max_withdrawal >= 0),
  CHECK (referral_commission_percent BETWEEN 0 AND 100),
  CHECK (billing_period IN ('monthly', 'lifetime')),
  CHECK (currency = 'NGN')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id CHAR(36) NOT NULL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'General',
  reward DECIMAL(10,2) NOT NULL DEFAULT 0,
  difficulty VARCHAR(30) NOT NULL DEFAULT 'Easy',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  task_url TEXT NOT NULL,
  daily_quota INT NOT NULL DEFAULT 0,
  proof_required BOOLEAN NOT NULL DEFAULT FALSE,
  proof_instructions TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_funded BOOLEAN NOT NULL DEFAULT FALSE,
  required_plan_code VARCHAR(40) NOT NULL DEFAULT 'free',
  verification_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
  campaign_budget_remaining DECIMAL(12,2) NULL,
  campaign_submission_id CHAR(36) NULL,
  KEY tasks_active_order (is_active, sort_order, created_at),
  CONSTRAINT tasks_plan_fk FOREIGN KEY (required_plan_code) REFERENCES subscription_plans(plan_code),
  CHECK (reward >= 0 AND daily_quota >= 0),
  CHECK (verification_mode IN ('manual', 'automatic')),
  CHECK (verification_mode <> 'automatic' OR task_url <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_completions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  proof_text TEXT NULL,
  proof_path TEXT NULL,
  review_note TEXT NULL,
  reviewed_at DATETIME(3) NULL,
  reviewed_by CHAR(36) NULL,
  UNIQUE KEY task_completion_user_unique (user_id, task_id),
  KEY task_completions_review_order (status, completed_at),
  CONSTRAINT task_completions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT task_completions_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT task_completions_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'approved', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referrals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  referrer_id CHAR(36) NOT NULL,
  referred_id CHAR(36) NOT NULL,
  bonus_paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY referrals_referred_unique (referred_id),
  CONSTRAINT referrals_referrer_fk FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT referrals_referred_fk FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS withdrawals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  wallet_type VARCHAR(20) NOT NULL DEFAULT 'hustler',
  bank_name VARCHAR(160) NOT NULL DEFAULT '',
  account_no VARCHAR(80) NOT NULL DEFAULT '',
  account_name VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  transaction_reference VARCHAR(255) NULL,
  processed_at DATETIME(3) NULL,
  processed_by CHAR(36) NULL,
  KEY withdrawals_user_date (user_id, requested_at),
  KEY withdrawals_review_date (status, requested_at),
  CONSTRAINT withdrawals_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT withdrawals_processor_fk FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (amount > 0),
  CHECK (wallet_type IN ('hustler', 'referral')),
  CHECK (status IN ('pending', 'paid', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  balance_type VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  balance_before DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY wallet_ledger_user_time (user_id, created_at),
  CONSTRAINT wallet_ledger_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT wallet_ledger_actor_fk FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (balance_type IN ('reward', 'referral', 'fund')),
  CHECK (amount <> 0 AND balance_after >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_code VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  provider VARCHAR(80) NULL,
  provider_reference VARCHAR(255) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  wallet_contribution DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(40) NOT NULL DEFAULT 'wallet',
  payment_proof TEXT NULL,
  expires_at DATETIME(3) NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY subscriptions_provider_reference_unique (provider_reference),
  KEY subscriptions_user_status (user_id, status, ends_at),
  CONSTRAINT subscriptions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT subscriptions_plan_fk FOREIGN KEY (plan_code) REFERENCES subscription_plans(plan_code),
  CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  CHECK (amount >= 0 AND wallet_contribution >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funding_settings (
  singleton TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  bank_name VARCHAR(160) NOT NULL DEFAULT '',
  account_name VARCHAR(160) NOT NULL DEFAULT '',
  account_number VARCHAR(80) NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT funding_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (singleton = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funding_deposits (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  provider_reference VARCHAR(255) NULL,
  proof_text TEXT NULL,
  proof_path TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  review_note TEXT NULL,
  reviewed_at DATETIME(3) NULL,
  reviewed_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY funding_provider_reference_unique (provider_reference),
  KEY funding_user_date (user_id, created_at),
  KEY funding_review (status, created_at),
  CONSTRAINT funding_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT funding_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (amount > 0),
  CHECK (payment_method IN ('paystack', 'flutterwave', 'manual')),
  CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_content (
  content_key VARCHAR(100) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body LONGTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT site_content_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (content_key REGEXP '^[a-z0-9._-]{1,100}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_settings (
  singleton TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  referral_signup_reward DECIMAL(12,2) NOT NULL DEFAULT 200,
  referral_first_hustle_reward DECIMAL(12,2) NOT NULL DEFAULT 200,
  milestone_reward DECIMAL(12,2) NOT NULL DEFAULT 2000,
  hustler_withdrawals_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  referral_withdrawals_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  withdrawal_failure_message TEXT NOT NULL,
  minimum_hustles INT NOT NULL DEFAULT 0,
  require_all_hustles BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_hustle_level INT NOT NULL DEFAULT 0,
  minimum_referrals INT NOT NULL DEFAULT 0,
  minimum_checkin_streak INT NOT NULL DEFAULT 0,
  minimum_online_minutes INT NOT NULL DEFAULT 0,
  minimum_interactions INT NOT NULL DEFAULT 0,
  measurement_days INT NOT NULL DEFAULT 30,
  hustler_payout_days JSON NOT NULL,
  hustler_window_start TIME NOT NULL DEFAULT '14:00:00',
  hustler_window_end TIME NOT NULL DEFAULT '18:00:00',
  hustler_timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Lagos',
  referral_payout_days JSON NOT NULL,
  referral_window_start TIME NOT NULL DEFAULT '14:00:00',
  referral_window_end TIME NOT NULL DEFAULT '18:00:00',
  referral_timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Lagos',
  auto_review_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT platform_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (singleton = 1),
  CHECK (minimum_hustle_level BETWEEN 0 AND 6),
  CHECK (measurement_days BETWEEN 1 AND 365),
  CHECK (auto_review_mode IN ('manual', 'approve', 'reject'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_checkins (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  checkin_date DATE NOT NULL,
  streak INT NOT NULL,
  reward DECIMAL(12,2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY daily_checkin_user_day (user_id, checkin_date),
  CONSTRAINT daily_checkins_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (streak > 0 AND reward >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id CHAR(36) NOT NULL,
  activity_date DATE NOT NULL,
  online_seconds INT NOT NULL DEFAULT 0,
  interactions INT NOT NULL DEFAULT 0,
  paid_online_blocks INT NOT NULL DEFAULT 0,
  paid_interaction_blocks INT NOT NULL DEFAULT 0,
  last_heartbeat_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, activity_date),
  CONSTRAINT activity_daily_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (online_seconds >= 0 AND interactions >= 0 AND paid_online_blocks >= 0 AND paid_interaction_blocks >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_milestones (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  milestone_type VARCHAR(20) NOT NULL,
  milestone_value INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY reward_milestone_unique (user_id, milestone_type, milestone_value),
  CONSTRAINT reward_milestones_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (milestone_type IN ('hustles', 'referrals') AND milestone_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_reward_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  referral_id CHAR(36) NOT NULL,
  reward_type VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY referral_reward_once (referral_id, reward_type),
  CONSTRAINT referral_reward_referral_fk FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE CASCADE,
  CHECK (reward_type IN ('signup', 'first_hustle') AND amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leaderboard_reward_settings (
  `rank` INT NOT NULL PRIMARY KEY,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT leaderboard_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (`rank` BETWEEN 1 AND 20 AND amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leaderboard_reward_runs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  period_start DATE NOT NULL,
  category VARCHAR(20) NOT NULL,
  user_id CHAR(36) NOT NULL,
  `rank` INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  issued_by CHAR(36) NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY leaderboard_reward_once (period_start, category, user_id),
  CONSTRAINT leaderboard_runs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT leaderboard_runs_admin_fk FOREIGN KEY (issued_by) REFERENCES users(id),
  CHECK (category IN ('earnings', 'hustles', 'referrals') AND `rank` BETWEEN 1 AND 20 AND amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dashboard_advertisements (
  singleton TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  image_path TEXT NULL,
  target_url TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT dashboard_ads_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (singleton = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_permissions (
  feature_key VARCHAR(60) NOT NULL PRIMARY KEY,
  free_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  premium_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT feature_permissions_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_announcements (
  singleton TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  title VARCHAR(255) NOT NULL DEFAULT 'Welcome to Mr Hustle',
  message TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  welcome_bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
  require_social BOOLEAN NOT NULL DEFAULT FALSE,
  social_links JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT announcement_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (singleton = 1 AND welcome_bonus >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS welcome_bonus_claims (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  amount DECIMAL(12,2) NOT NULL,
  claimed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT welcome_claim_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payout_settings (
  singleton TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  minimum_amount DECIMAL(12,2) NOT NULL DEFAULT 500,
  payout_days JSON NOT NULL,
  window_start TIME NOT NULL DEFAULT '14:00:00',
  window_end TIME NOT NULL DEFAULT '18:00:00',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Lagos',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT payout_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (singleton = 1 AND minimum_amount >= 500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaign_submissions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL,
  reward DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  budget DECIMAL(12,2) NOT NULL,
  task_url TEXT NOT NULL,
  proof_instructions VARCHAR(1000) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  review_note TEXT NULL,
  reviewed_at DATETIME(3) NULL,
  reviewed_by CHAR(36) NULL,
  task_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY campaign_submissions_user_date (user_id, created_at),
  KEY campaign_submissions_review (status, created_at),
  CONSTRAINT campaign_submissions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT campaign_submissions_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT campaign_submissions_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  CHECK (quantity BETWEEN 1 AND 1000 AND reward > 0 AND budget > 0),
  CHECK (status IN ('pending', 'approved', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_verification_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'started',
  provider_reference VARCHAR(255) NULL,
  completion_id CHAR(36) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  UNIQUE KEY task_verification_completion_unique (completion_id),
  KEY task_verification_user_task_status (user_id, task_id, status),
  KEY task_verification_expiry (status, expires_at),
  CONSTRAINT task_verification_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT task_verification_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT task_verification_completion_fk FOREIGN KEY (completion_id) REFERENCES task_completions(id) ON DELETE SET NULL,
  CHECK (status IN ('started', 'completed', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_verification_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  result VARCHAR(20) NOT NULL,
  provider_reference VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT verification_events_session_fk FOREIGN KEY (session_id) REFERENCES task_verification_sessions(id) ON DELETE CASCADE,
  CONSTRAINT verification_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT verification_events_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CHECK (result IN ('verified', 'rejected', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_conversations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  subject VARCHAR(255) NOT NULL DEFAULT 'Support request',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY support_user_status_updated (user_id, status, updated_at),
  CONSTRAINT support_conversations_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (status IN ('open', 'closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_messages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  author_id CHAR(36) NOT NULL,
  body VARCHAR(4000) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY support_messages_conversation_date (conversation_id, created_at),
  CONSTRAINT support_messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE,
  CONSTRAINT support_messages_author_fk FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (CHAR_LENGTH(TRIM(body)) BETWEEN 1 AND 4000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  subject_user_id CHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  details JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY admin_activity_time (created_at),
  CONSTRAINT admin_activity_actor_fk FOREIGN KEY (actor_id) REFERENCES users(id),
  CONSTRAINT admin_activity_subject_fk FOREIGN KEY (subject_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_login_history (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(1000) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY user_login_history_user_time (user_id, created_at),
  CONSTRAINT user_login_history_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_smtp_settings (
  singleton TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  host VARCHAR(255) NOT NULL DEFAULT '',
  port INT NOT NULL DEFAULT 587,
  secure BOOLEAN NOT NULL DEFAULT FALSE,
  username VARCHAR(255) NOT NULL DEFAULT '',
  from_email VARCHAR(254) NOT NULL DEFAULT '',
  from_name VARCHAR(160) NOT NULL DEFAULT 'MrHustler',
  password_ciphertext TEXT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT smtp_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (singleton = 1 AND port BETWEEN 1 AND 65535)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_notification_templates (
  event_key VARCHAR(80) NOT NULL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  subject_template VARCHAR(200) NOT NULL,
  body_template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  available_variables JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  CONSTRAINT email_templates_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO email_notification_templates
  (event_key, title, subject_template, body_template, available_variables)
VALUES
  ('referral_registered', 'New referral signup', 'A friend joined with your referral link', 'Hi {{first_name}},\n\n{{referred_name}} joined using your referral link on {{event_date}}.\n\nKeep sharing your link to grow your referral rewards.', JSON_ARRAY('first_name', 'referred_name', 'event_date')),
  ('referral_first_hustle', 'Referral completed first hustle', 'Your referral completed their first hustle', 'Hi {{first_name}},\n\n{{referred_name}} completed their first hustle. Your referral bonus is {{bonus_status}}.\n\nThank you for growing the community.', JSON_ARRAY('first_name', 'referred_name', 'bonus_status')),
  ('hustle_approved', 'Hustle approved', 'Your hustle was approved', 'Hi {{first_name}},\n\nYour submission for {{task_title}} was approved. {{reward_message}}', JSON_ARRAY('first_name', 'task_title', 'reward_message')),
  ('hustle_rejected', 'Hustle needs attention', 'Update on your hustle submission', 'Hi {{first_name}},\n\nYour submission for {{task_title}} was not approved. Review note: {{review_note}}', JSON_ARRAY('first_name', 'task_title', 'review_note')),
  ('withdrawal_requested', 'Withdrawal requested', 'We received your withdrawal request', 'Hi {{first_name}},\n\nYour request to withdraw {{amount}} from your {{wallet_type}} wallet was received on {{event_date}}. Status: {{status}}.', JSON_ARRAY('first_name', 'amount', 'wallet_type', 'event_date', 'status')),
  ('withdrawal_paid', 'Withdrawal paid', 'Your withdrawal has been paid', 'Hi {{first_name}},\n\nYour withdrawal of {{amount}} was marked paid. Reference: {{reference}}.', JSON_ARRAY('first_name', 'amount', 'reference')),
  ('withdrawal_rejected', 'Withdrawal update', 'Your withdrawal request was not approved', 'Hi {{first_name}},\n\nYour withdrawal of {{amount}} was rejected. Note: {{review_note}}', JSON_ARRAY('first_name', 'amount', 'review_note')),
  ('funding_submitted', 'Funding submitted', 'We received your wallet funding submission', 'Hi {{first_name}},\n\nYour funding submission for {{amount}} via {{payment_method}} is under review.', JSON_ARRAY('first_name', 'amount', 'payment_method')),
  ('funding_confirmed', 'Funding confirmed', 'Your wallet funding was confirmed', 'Hi {{first_name}},\n\nYour wallet funding of {{amount}} was confirmed.', JSON_ARRAY('first_name', 'amount')),
  ('funding_rejected', 'Funding update', 'Your wallet funding needs attention', 'Hi {{first_name}},\n\nYour funding submission for {{amount}} was rejected. Note: {{review_note}}', JSON_ARRAY('first_name', 'amount', 'review_note')),
  ('subscription_activated', 'Plan activated', 'Your {{plan_name}} plan is active', 'Hi {{first_name}},\n\nYour {{plan_name}} plan was activated on {{event_date}}.', JSON_ARRAY('first_name', 'plan_name', 'event_date')),
  ('wallet_adjusted', 'Wallet activity', 'An adjustment was made to your {{wallet_type}} wallet', 'Hi {{first_name}},\n\nAn administrator recorded {{amount}} on your {{wallet_type}} wallet. Reason: {{reason}}', JSON_ARRAY('first_name', 'amount', 'wallet_type', 'reason'));

CREATE TABLE IF NOT EXISTS email_notification_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NULL,
  event_key VARCHAR(80) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  processing_started_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  KEY email_queue_pending (status, created_at),
  CONSTRAINT email_queue_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_email_rate_limits (
  rate_key VARCHAR(100) NOT NULL PRIMARY KEY,
  window_started_at DATETIME(3) NOT NULL,
  request_count INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CHECK (request_count > 0),
  KEY auth_email_rate_limits_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_files (
  id CHAR(36) NOT NULL PRIMARY KEY,
  bucket VARCHAR(80) NOT NULL,
  object_path VARCHAR(1024) NOT NULL,
  owner_id CHAR(36) NULL,
  mime_type VARCHAR(160) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY storage_bucket_path_unique (bucket, object_path(255)),
  KEY storage_owner_bucket (owner_id, bucket),
  CONSTRAINT storage_files_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO subscription_plans
  (plan_code, name, description, price, currency, daily_task_limit, daily_earning_cap, max_withdrawal, referral_commission_percent, billing_period)
VALUES
  ('free', 'H. Free', '', 0, 'NGN', 30, 4000, 500, 5, 'monthly'),
  ('premium', 'H. Maniac', '', 5000, 'NGN', 100, 20000, 500, 10, 'monthly'),
  ('vip', 'H. Supreme Max', '', 20000, 'NGN', 2147483647, NULL, 500, 15, 'monthly'),
  ('president', 'H. President Max', '', 0, 'NGN', 2147483647, NULL, 500, 15, 'lifetime');

INSERT IGNORE INTO platform_settings
  (singleton, withdrawal_failure_message, hustler_payout_days, referral_payout_days)
VALUES (1, 'Your account has not met the withdrawal requirements yet.', JSON_ARRAY(5), JSON_ARRAY(5));

INSERT IGNORE INTO payout_settings (singleton, payout_days) VALUES (1, JSON_ARRAY(5));
INSERT IGNORE INTO funding_settings (singleton, instructions) VALUES (1, 'Transfer the exact amount, then submit your proof of payment.');
INSERT IGNORE INTO email_smtp_settings (singleton) VALUES (1);
INSERT IGNORE INTO dashboard_advertisements (singleton) VALUES (1);
INSERT IGNORE INTO platform_announcements (singleton, message, social_links) VALUES (1, '', JSON_ARRAY());

INSERT IGNORE INTO feature_permissions (feature_key, settings)
VALUES
  ('hustles', JSON_OBJECT()),
  ('referrals', JSON_OBJECT()),
  ('leaderboard', JSON_OBJECT()),
  ('campaigns', JSON_OBJECT()),
  ('transfers', JSON_OBJECT()),
  ('custom-referral-code', JSON_OBJECT()),
  ('priority-support', JSON_OBJECT());
