export { mysqlApi } from './mysqlApi';

export type Profile = {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  tier: string;
  referral_code: string | null;
  joined_at: string;
  account_status?: 'active' | 'suspended' | 'banned';
  status_reason?: string | null;
  public_activity_opt_in?: boolean;
  leaderboard_opt_in?: boolean;
};

export type Balance = {
  id: string;
  user_id: string;
  reward_balance: number;
  referral_balance: number;
  fund_balance: number;
  total_earned: number;
  updated_at: string;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  category: string;
  reward: number;
  difficulty: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  task_url: string;
  daily_quota: number;
  proof_required: boolean;
  proof_instructions: string;
  sort_order: number;
  is_funded: boolean;
  required_plan_code: string;
  verification_mode: 'manual' | 'automatic';
};

export type TaskCompletion = {
  id: string;
  user_id: string;
  task_id: string;
  status: string;
  completed_at: string;
  proof_text?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  proof_path?: string | null;
};

export type Referral = {
  id: string;
  referrer_id: string;
  referred_id: string;
  bonus_paid: boolean;
  created_at: string;
};

export type Withdrawal = {
  id: string;
  user_id: string;
  amount: number;
  wallet_type?: 'hustler' | 'referral';
  bank_name: string;
  account_no: string;
  account_name: string;
  status: string;
  requested_at: string;
  transaction_reference: string | null;
  processed_at: string | null;
  processed_by: string | null;
};
