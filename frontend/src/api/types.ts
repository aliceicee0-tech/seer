// Types partagés — moteur PARI MUTUEL (modèle broker).

export type Category = "WEATHER" | "SOCIAL" | "TRENDING" | "SPORTS";
export type MarketStatus =
  | "DRAFT" | "OPEN" | "LOCKED" | "RESOLVING" | "RESOLVED" | "CANCELLED" | "FROZEN";
export type Outcome = "YES" | "NO";
export type BetStatus = "PENDING" | "WON" | "LOST" | "REFUNDED";
export type Operator = "MVOLA" | "ORANGE" | "AIRTEL";
export type DepositStatus = "PENDING" | "APPROVED" | "REJECTED";
export type WithdrawStatus = "PENDING" | "PAID" | "REJECTED";

export interface User {
  id: string;
  phone: string;
  display_name: string;
  balance: string;
  available_balance: string;
  locked_balance: string;
  is_platform_admin: boolean;
  date_joined: string;
}

export interface Market {
  id: number;
  question: string;
  category: Category;
  category_label: string;
  status: MarketStatus;
  proba_yes: string;   // conservé pour compat v_markets (devient ratio mises)
  proba_no: string;
  last_price: string | null;  // null en pari mutuel (plus de prix de trade)
  bet_close_at: string;
  resolve_at: string;
  image_url?: string;
  is_featured: boolean;
  outcome?: Outcome;
  description?: string;
  source_url?: string;
  source_rules?: string;
  resolved_at?: string | null;
}

export interface MarketPool {
  pool_yes: string;
  pool_no: string;
  total: string;
  odds_yes: number | null;   // cote = total / pool_yes (null si pool_yes = 0)
  odds_no: number | null;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// --------------------------------------------------------------------------
// Paris (pari mutuel)
// --------------------------------------------------------------------------

export interface Bet {
  id: number;
  market_id: number;
  market_question: string;
  market_status: MarketStatus;
  market_outcome?: Outcome;   // issue du marché (après résolution)
  outcome: Outcome;
  outcome_label: string;
  amount: string;
  payout: string;
  status: BetStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface MobileMoneyInfo {
  holder: string;
  numbers: Record<Operator, string>;
}

export interface DepositRequest {
  id: number;
  code: string;
  amount: string;
  operator: Operator;
  operator_label: string;
  sender_phone: string;
  operator_ref: string;
  status: DepositStatus;
  status_label: string;
  admin_note: string;
  created_at: string;
  processed_at: string | null;
}

export interface WithdrawRequest {
  id: number;
  code: string;
  amount: string;
  operator: Operator;
  operator_label: string;
  recipient_phone: string;
  status: WithdrawStatus;
  status_label: string;
  admin_note: string;
  created_at: string;
  processed_at: string | null;
  operator_ref: string;
}

export interface LedgerEntry {
  id: number;
  type: string;
  type_label: string;
  amount: string;
  balance_after: string;
  reference: string;
  note: string;
  created_at: string;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: User;
}

// --- Types spécifiques au dashboard admin ---------------------------------

export interface AdminStats {
  users_total: number;
  markets_open: number;
  markets_locked: number;
  markets_resolved: number;
  deposits_pending: number;
  deposits_pending_amount: string;
  withdrawals_pending: number;
  withdrawals_pending_amount: string;
  cash_collected_net: string;
}

export interface AdminDeposit extends DepositRequest {
  user_id: number;
  user_phone: string;
  user_name: string;
}

export interface AdminWithdraw extends WithdrawRequest {
  user_id: number;
  user_phone: string;
  user_name: string;
}

export interface AdminUser {
  id: number;
  phone: string;
  display_name: string;
  is_active: boolean;
  is_staff: boolean;
  balance: string;
  available_balance: string;
  locked_balance: string;
  positions_count: number;
  date_joined: string;
}

export interface AdminLedgerEntry {
  id: number;
  type: string;
  type_label: string;
  amount: string;
  balance_after: string;
  reference: string;
  note: string;
  user_phone: string;
  created_by: number | null;
  created_at: string;
}

export interface MarketFormData {
  question: string;
  description: string;
  category: Category;
  source_url: string;
  source_rules: string;
  bet_close_at: string;  // datetime-local format: YYYY-MM-DDTHH:mm
  resolve_at: string;
  image_url?: string;
  is_featured?: boolean;
  status?: MarketStatus;
}
