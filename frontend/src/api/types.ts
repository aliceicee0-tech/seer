// Types partagés alignés sur les serializers Django (moteur Polymarket / CLOB).

export type Category = "WEATHER" | "SOCIAL" | "TRENDING" | "SPORTS";
export type MarketStatus =
  | "DRAFT" | "OPEN" | "LOCKED" | "RESOLVING" | "RESOLVED" | "CANCELLED" | "FROZEN";
export type Outcome = "YES" | "NO";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED" | "EXPIRED";
export type Operator = "MVOLA" | "ORANGE" | "AIRTEL";
export type DepositStatus = "PENDING" | "APPROVED" | "REJECTED";
export type WithdrawStatus = "PENDING" | "PAID" | "REJECTED";

export interface User {
  id: number;
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
  proba_yes: string;
  proba_no: string;
  last_price: string | null;   // dernier prix de trade (null si aucun échange)
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
  escrow_balance: string;
  pairs_created: number;
  pairs_destroyed: number;
  pairs_in_circulation: number;
  invariant_ok: boolean;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// --------------------------------------------------------------------------
// Carnet d'ordres (CLOB)
// --------------------------------------------------------------------------

export interface OrderBookLevel {
  price: string;
  quantity: number;
}

export interface OrderBook {
  outcome: Outcome;
  bids: OrderBookLevel[];   // achats en attente (meilleur = +haut)
  asks: OrderBookLevel[];   // ventes en attente (meilleur = +bas)
  spread: string | null;
  last_price: string | null;
}

export interface Trade {
  id: number;
  market: number;
  outcome: Outcome;
  price: string;
  quantity: number;
  buyer_phone: string;
  seller_phone: string;
  created_at: string;
}

export interface PricePoint {
  at: string;
  price: string;
  quantity: number;
}

export interface Order {
  id: number;
  market: number;
  market_question: string;
  side: OrderSide;
  side_label: string;
  outcome: Outcome;
  outcome_label: string;
  order_type: OrderType;
  price: string | null;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: OrderStatus;
  status_label: string;
  expires_at?: string | null;
  created_at: string;
}

export interface OrderInput {
  side: OrderSide;
  outcome: Outcome;
  order_type: OrderType;
  price?: string | null;
  quantity: number;
  expires_at?: string | null;
}

// --------------------------------------------------------------------------
// Positions
// --------------------------------------------------------------------------

export interface Position {
  id: number;
  market: number;
  market_question: string;
  market_status: MarketStatus;
  outcome: Outcome;
  outcome_label: string;
  quantity: number;
  locked_quantity: number;
  available_quantity: number;
  avg_buy_price: string;
  last_price: string | null;
  current_value: string;
  pnl: string;
  updated_at: string;
}

export interface Estimate {
  quantity: string;
  outcome: Outcome;
  current_price: string | null;
  current_cost: string | null;
  payout_if_win: string;
  profit_if_win: string | null;
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
