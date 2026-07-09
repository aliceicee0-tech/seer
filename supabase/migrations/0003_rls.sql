-- ===========================================================================
--  Nexus v2 — Row Level Security
--
--  Remplace les permissions Django/DRF par des policies Postgres.
--  Règle : un utilisateur ne voit que SES données (wallet, positions, ordres,
--  paiements). Les marchés et le carnet d'ordres sont publics (lecture).
--  Les actions d'écriture sensibles (argent) passent par des fonctions RPC
--  SECURITY DEFINER qui court-circuitent la RLS en toute sécurité.
-- ===========================================================================

-- Helper : id de l'utilisateur courant (depuis le JWT Supabase).
create or replace function public.current_user_id()
returns uuid
language sql stable
as $$ select coalesce(auth.uid(), null); $$;

-- Helper : l'utilisateur courant est-il staff/admin ?
create or replace function public.is_platform_admin()
returns boolean
language sql stable
as $$
  select coalesce(
    (select is_staff or is_superuser from public.profiles where id = auth.uid()),
    false
  );
$$;

-- --------------------------------------------------------------------------
--  Wallets : chaque user ne voit que le sien. Admin = lecture globale.
-- --------------------------------------------------------------------------
alter table public.wallets enable row level security;

drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own on public.wallets
  for select using (user_id = auth.uid() or public.is_platform_admin());

-- Les écritures de solde passent UNIQUEMENT par les fonctions RPC SECURITY
-- DEFINER (post_entry, settle_*, etc.) — pas d'UPDATE direct depuis l'API.
drop policy if exists wallets_no_direct_write on public.wallets;
create policy wallets_no_direct_write on public.wallets
  for all using (false) with check (false);

-- --------------------------------------------------------------------------
--  Ledger entries : lecture = propriétaire du wallet ou admin.
--  Écriture = uniquement via RPC (jamais directe).
-- --------------------------------------------------------------------------
alter table public.ledger_entries enable row level security;

drop policy if exists ledger_select_own on public.ledger_entries;
create policy ledger_select_own on public.ledger_entries
  for select using (
    wallet_id in (select id from public.wallets where user_id = auth.uid())
    or public.is_platform_admin()
  );

drop policy if exists ledger_no_direct_write on public.ledger_entries;
create policy ledger_no_direct_write on public.ledger_entries
  for all using (false) with check (false);

-- --------------------------------------------------------------------------
--  Markets : lecture publique (catalogue). Écriture = admin uniquement.
-- --------------------------------------------------------------------------
alter table public.markets enable row level security;

drop policy if exists markets_public_read on public.markets;
create policy markets_public_read on public.markets
  for select using (true);

drop policy if exists markets_admin_write on public.markets;
create policy markets_admin_write on public.markets
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- --------------------------------------------------------------------------
--  Market pools : lecture publique (transparence de l'escrow). Écriture = RPC.
-- --------------------------------------------------------------------------
alter table public.market_pools enable row level security;

drop policy if exists pools_public_read on public.market_pools;
create policy pools_public_read on public.market_pools
  for select using (true);

drop policy if exists pools_rpc_write on public.market_pools;
create policy pools_rpc_write on public.market_pools
  for all using (false) with check (false);

-- --------------------------------------------------------------------------
--  Positions : lecture = propriétaire ou admin. Écriture = RPC.
-- --------------------------------------------------------------------------
alter table public.positions enable row level security;

drop policy if exists positions_select_own on public.positions;
create policy positions_select_own on public.positions
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists positions_rpc_write on public.positions;
create policy positions_rpc_write on public.positions
  for all using (false) with check (false);

-- --------------------------------------------------------------------------
--  Orders : lecture = propriétaire ou admin. Écriture = via RPC (place_order).
--  Note : le carnet d'ordres public (orderbook) est exposé par une fonction dédiée.
-- --------------------------------------------------------------------------
alter table public.orders enable row level security;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists orders_rpc_write on public.orders;
create policy orders_rpc_write on public.orders
  for all using (false) with check (false);

-- --------------------------------------------------------------------------
--  Trades : lecture publique (historique des transactions, anonyme).
-- --------------------------------------------------------------------------
alter table public.trades enable row level security;

drop policy if exists trades_public_read on public.trades;
create policy trades_public_read on public.trades
  for select using (true);

drop policy if exists trades_rpc_write on public.trades;
create policy trades_rpc_write on public.trades
  for all using (false) with check (false);

-- --------------------------------------------------------------------------
--  Deposit / Withdraw requests : lecture = propriétaire ou admin. Écriture = RPC.
-- --------------------------------------------------------------------------
alter table public.deposit_requests enable row level security;

drop policy if exists deposits_select_own on public.deposit_requests;
create policy deposits_select_own on public.deposit_requests
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists deposits_rpc_write on public.deposit_requests;
create policy deposits_rpc_write on public.deposit_requests
  for all using (false) with check (false);

alter table public.withdraw_requests enable row level security;

drop policy if exists withdrawals_select_own on public.withdraw_requests;
create policy withdrawals_select_own on public.withdraw_requests
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists withdrawals_rpc_write on public.withdraw_requests;
create policy withdrawals_rpc_write on public.withdraw_requests
  for all using (false) with check (false);

-- --------------------------------------------------------------------------
--  Profiles : lecture = soi-même ou admin. Écriture = soi-même (display_name).
-- --------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
