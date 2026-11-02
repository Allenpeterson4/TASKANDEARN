import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
};

export type Balance = {
  id: string;
  user_id: string;
  reward_balance: number;
  referral_balance: number;
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
};

export type TaskCompletion = {
  id: string;
  user_id: string;
  task_id: string;
  status: string;
  completed_at: string;
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
  bank_name: string;
  account_no: string;
  account_name: string;
  status: string;
  requested_at: string;
};
