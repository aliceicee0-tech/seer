-- ===========================================================================
--  Nexus v2 — Vues d'enrichissement (compatibilité frontend)
--
--  Ces vues calculent les champs dérivés que les serializers Django
--  fournissaient (labels FR, P&L, joins, prix moyen). Les Edge Functions
--  les lisent directement → zéro logique côté TypeScript.
-- ===========================================================================

-- --------------------------------------------------------------------------
--  Label des enums (français) — utilisé partout pour *_label.
-- --------------------------------------------------------------------------
create or replace function public.category_label(c public.market_category)
returns text language sql immutable as $$
  select case c when 'WEATHER' then 'Météo' when 'SOCIAL' then 'Réseaux sociaux'
       when 'TRENDING' then 'Tendances' when 'SPORTS' then 'Sport' end;
$$;

create or replace function public.order_side_label(s public.order_side)
returns text language sql immutable as $$
  select case s when 'BUY' then 'Achat' when 'SELL' then 'Vente' end;
$$;

create or replace function public.order_status_label(s public.order_status)
returns text language sql immutable as $$
  select case s when 'OPEN' then 'Ouvert' when 'PARTIAL' then 'Partiel'
       when 'FILLED' then 'Exécuté' when 'CANCELLED' then 'Annulé'
       when 'EXPIRED' then 'Expiré' end;
$$;

create or replace function public.deposit_status_label(s public.deposit_status)
returns text language sql immutable as $$
  select case s when 'PENDING' then 'En attente' when 'APPROVED' then 'Approuvée'
       when 'REJECTED' then 'Rejetée' end;
$$;

create or replace function public.withdraw_status_label(s public.withdraw_status)
returns text language sql immutable as $$
  select case s when 'PENDING' then 'En attente' when 'PAID' then 'Payée'
       when 'REJECTED' then 'Rejetée' end;
$$;

create or replace function public.operator_label(o public.payment_operator)
returns text language sql immutable as $$
  select case o when 'MVOLA' then 'MVola' when 'ORANGE' then 'Orange Money'
       when 'AIRTEL' then 'Airtel Money' end;
$$;

create or replace function public.ledger_type_label(t varchar)
returns text language sql immutable as $$
  select case t
    when 'DEPOSIT' then 'Dépôt' when 'WITHDRAW' then 'Retrait'
    when 'MINT' then 'Émission de paires' when 'MERGE' then 'Fusion de paires'
    when 'TRADE_BUY' then 'Achat au carnet' when 'TRADE_SELL' then 'Vente au carnet'
    when 'SETTLE_WIN' then 'Gain de résolution' when 'SETTLE_FEE' then 'Commission plateforme'
    when 'ORDER_REFUND' then 'Remboursement d''ordre'
    when 'ADJUSTMENT' then 'Ajustement manuel' else t end;
$$;

-- ===========================================================================
--  v_markets — marché + dernier prix + probas + labels
-- ===========================================================================
create or replace view public.v_markets as
select
  m.id, m.question, m.description, m.category,
  public.category_label(m.category) as category_label,
  m.source_url, m.source_rules, m.status, m.outcome,
  m.bet_close_at, m.resolve_at, m.resolved_at, m.image_url, m.is_featured,
  m.created_at,
  -- Dernier prix de trade sur ce marché.
  coalesce((
    select t.price from public.trades t
    where t.market_id = m.id order by t.created_at desc, t.id desc limit 1
  ), null) as last_price,
  -- Probabilités implicites dérivées du dernier prix (1 part = SHARE_VALUE).
  case when (
    select t.price from public.trades t
    where t.market_id = m.id order by t.created_at desc, t.id desc limit 1
  ) is null then '0.5000'
  else (
    select to_char((select t.price from public.trades t
      where t.market_id = m.id order by t.created_at desc, t.id desc limit 1)
      / (select current_setting('app.share_value', true)::numeric
         ) , 'FM0.0000')
  ) end as proba_yes,
  case when (
    select t.price from public.trades t
    where t.market_id = m.id order by t.created_at desc, t.id desc limit 1
  ) is null then '0.5000'
  else to_char(1 - (
    (select t.price from public.trades t
      where t.market_id = m.id order by t.created_at desc, t.id desc limit 1)
    / (select current_setting('app.share_value', true)::numeric)
  ), 'FM0.0000') end as proba_no
from public.markets m;

-- ===========================================================================
--  v_market_pools — pool + invariant_ok + pairs_in_circulation
-- ===========================================================================
create or replace view public.v_market_pools as
select
  p.market_id,
  p.escrow_balance::text as escrow_balance,
  p.pairs_created,
  p.pairs_destroyed,
  (p.pairs_created - p.pairs_destroyed) as pairs_in_circulation,
  (p.escrow_balance = (p.pairs_created - p.pairs_destroyed)
     * (select current_setting('app.share_value', true)::numeric)) as invariant_ok
from public.market_pools p;

-- ===========================================================================
--  v_trades — trade + téléphones acheteur/vendeur
-- ===========================================================================
create or replace view public.v_trades as
select
  t.id, t.market_id as market, t.outcome,
  t.price::text as price, t.quantity,
  bp.phone as buyer_phone, sp.phone as seller_phone,
  t.created_at
from public.trades t
join public.profiles bp on bp.id = t.buyer_id
join public.profiles sp on sp.id = t.seller_id;

-- ===========================================================================
--  v_price_history — série temporelle des prix (champ 'at' pour le frontend)
-- ===========================================================================
create or replace view public.v_price_history as
select
  t.created_at as at,
  t.price::text as price,
  t.quantity,
  t.market_id
from public.trades t
order by t.created_at asc;

-- ===========================================================================
--  v_orders — ordre + labels + question marché + remaining
-- ===========================================================================
create or replace view public.v_orders as
select
  o.id, o.market_id as market,
  m.question as market_question,
  o.side, public.order_side_label(o.side) as side_label,
  o.outcome, case o.outcome when 'YES' then 'OUI' else 'NON' end as outcome_label,
  o.order_type,
  o.price::text as price, o.quantity, o.filled_quantity,
  (o.quantity - o.filled_quantity) as remaining_quantity,
  o.status, public.order_status_label(o.status) as status_label,
  o.expires_at, o.created_at
from public.orders o
join public.markets m on m.id = o.market_id;

-- ===========================================================================
--  v_positions — position + enrichissements (question, labels, last_price, P&L)
-- ===========================================================================
create or replace view public.v_positions as
select
  pos.id, pos.user_id, pos.market_id as market,
  m.question as market_question, m.status as market_status,
  pos.outcome,
  case pos.outcome when 'YES' then 'OUI' else 'NON' end as outcome_label,
  pos.quantity, pos.locked_quantity,
  (pos.quantity - pos.locked_quantity) as available_quantity,
  pos.avg_buy_price::text as avg_buy_price,
  -- Dernier prix de trade sur le marché (même pour les deux côtés).
  (select t.price::text from public.trades t
   where t.market_id = pos.market_id
   order by t.created_at desc, t.id desc limit 1) as last_price,
  -- Valeur courante = qty × dernier prix (null si pas de marché actif).
  case when (select t.price from public.trades t
             where t.market_id = pos.market_id
             order by t.created_at desc, t.id desc limit 1) is not null
  then to_char(pos.quantity * (
    select t.price from public.trades t
    where t.market_id = pos.market_id
    order by t.created_at desc, t.id desc limit 1), 'FM999999990.00')
  else null end as current_value,
  -- P&L = (prix courant − prix moyen) × qty.
  case when (select t.price from public.trades t
             where t.market_id = pos.market_id
             order by t.created_at desc, t.id desc limit 1) is not null
  then to_char((
    (select t.price from public.trades t
     where t.market_id = pos.market_id
     order by t.created_at desc, t.id desc limit 1) - pos.avg_buy_price
  ) * pos.quantity, 'FM999999990.00')
  else null end as pnl,
  pos.updated_at
from public.positions pos
join public.markets m on m.id = pos.market_id
where pos.quantity > 0;

-- ===========================================================================
--  v_deposits / v_withdraws — demandes + labels (vue joueur, sans user_phone)
-- ===========================================================================
create or replace view public.v_deposits as
select
  d.id, d.user_id, d.code, d.amount::text as amount,
  d.operator, public.operator_label(d.operator) as operator_label,
  d.sender_phone, d.operator_ref,
  d.status, public.deposit_status_label(d.status) as status_label,
  d.admin_note, d.created_at, d.processed_at
from public.deposit_requests d;

create or replace view public.v_withdraws as
select
  w.id, w.user_id, w.code, w.amount::text as amount,
  w.operator, public.operator_label(w.operator) as operator_label,
  w.recipient_phone,
  w.status, public.withdraw_status_label(w.status) as status_label,
  w.admin_note, w.created_at, w.processed_at, w.operator_ref
from public.withdraw_requests w;

-- ===========================================================================
--  v_admin_deposits / v_admin_withdraws — vue admin (+ user_phone, user_name)
-- ===========================================================================
create or replace view public.v_admin_deposits as
select
  d.id, d.user_id::text as user_id, d.code, d.amount::text as amount,
  d.operator, public.operator_label(d.operator) as operator_label,
  d.sender_phone, d.operator_ref,
  d.status, public.deposit_status_label(d.status) as status_label,
  d.admin_note, d.created_at, d.processed_at,
  p.phone as user_phone, coalesce(p.display_name, '') as user_name
from public.deposit_requests d
join public.profiles p on p.id = d.user_id;

create or replace view public.v_admin_withdraws as
select
  w.id, w.user_id::text as user_id, w.code, w.amount::text as amount,
  w.operator, public.operator_label(w.operator) as operator_label,
  w.recipient_phone,
  w.status, public.withdraw_status_label(w.status) as status_label,
  w.admin_note, w.created_at, w.processed_at, w.operator_ref,
  p.phone as user_phone, coalesce(p.display_name, '') as user_name
from public.withdraw_requests w
join public.profiles p on p.id = w.user_id;

-- ===========================================================================
--  v_ledger_entries — écriture + label (vue joueur)
-- ===========================================================================
create or replace view public.v_ledger_entries as
select
  e.id, e.type, public.ledger_type_label(e.type) as type_label,
  e.amount::text as amount, e.balance_after::text as balance_after,
  e.reference, e.note, e.created_at
from public.ledger_entries e;

-- ===========================================================================
--  v_admin_ledger — journal global + user_phone + created_by
-- ===========================================================================
create or replace view public.v_admin_ledger as
select
  e.id, e.type, public.ledger_type_label(e.type) as type_label,
  e.amount::text as amount, e.balance_after::text as balance_after,
  e.reference, e.note, e.created_at,
  wp.phone as user_phone,
  e.created_by::text as created_by
from public.ledger_entries e
join public.wallets w on w.id = e.wallet_id
join public.profiles wp on wp.id = w.user_id;

-- ===========================================================================
--  v_admin_users — joueurs + solde + compte de positions
-- ===========================================================================
create or replace view public.v_admin_users as
select
  p.id::text as id, p.phone, coalesce(p.display_name, '') as display_name,
  (p.is_staff = false and p.is_superuser = false) as is_active_joueur,
  p.is_staff, p.is_superuser,
  coalesce(w.balance, 0)::text as balance,
  (coalesce(w.balance, 0) - coalesce(w.locked_balance, 0))::text as available_balance,
  coalesce(w.locked_balance, 0)::text as locked_balance,
  (select count(*) from public.positions pos where pos.user_id = p.id and pos.quantity > 0) as positions_count,
  p.created_at as date_joined
from public.profiles p
left join public.wallets w on w.user_id = p.id
where p.is_staff = false and p.is_superuser = false;
