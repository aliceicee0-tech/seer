-- ===========================================================================
--  Nexus v2 — Markets RPC (partie 2 : résolution, annulation, cron)
--
--  Reproduit markets/services.py :
--    - _release_order_resources (L443-473)
--    - cancel_order (L476-488)
--    - resolve_market (L527-621)
--    - cancel_market (L624-705)
--    - auto_lock_expired_markets (L712-726)
--    - freeze_market (L733-739)
--    - verify_invariants (L742-822)
-- ===========================================================================

-- Helper : libère le séquestre/parts d'un ordre (annulation).
-- Reproduit _release_order_resources (L443-473).
create or replace function public.release_order_resources(
  p_order_id bigint,
  p_by_user  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_remaining bigint;
  v_wallet_id bigint;
  v_pos_id bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  v_remaining := v_order.quantity - v_order.filled_quantity;

  if v_order.side = 'BUY' and v_order.order_type = 'LIMIT' then
    select id into v_wallet_id from public.wallets where user_id = v_order.user_id;
    perform public.unlock_amount(v_wallet_id, v_order.price * v_remaining);
    -- Écriture de trace (montant 0 : le solde ne change pas).
    perform public.post_entry(
      p_wallet_id := v_wallet_id,
      p_entry_type := 'ORDER_REFUND',
      p_amount := 0,
      p_reference := '#RFD-O' || p_order_id,
      p_note := 'Annulation ordre achat — libération séquestre ' || v_remaining || '× ' || v_order.price,
      p_created_by := p_by_user
    );
  elsif v_order.side = 'SELL' then
    v_pos_id := public.get_or_create_position_locked(v_order.user_id, v_order.market_id, v_order.outcome);
    update public.positions
      set locked_quantity = greatest(0, locked_quantity - v_remaining)
    where id = v_pos_id;
  end if;

  update public.orders set status = 'CANCELLED' where id = p_order_id;
end;
$$;


-- cancel_order — un joueur annule SON ordre (garde de propriété).
-- Reproduit cancel_order (L476-488).
create or replace function public.cancel_order(
  p_order_id bigint,
  p_user_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_order record;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.user_id <> p_user_id then
    perform public.market_error('Vous ne pouvez annuler que vos propres ordres.');
  end if;
  if v_order.status in ('FILLED', 'CANCELLED', 'EXPIRED') then
    perform public.market_error('Cet ordre n''est plus annulable.');
  end if;
  perform public.release_order_resources(p_order_id, p_user_id);
end;
$$;


-- ===========================================================================
--  resolve_market — résout un marché (paie les gagnants, détruit les perdants).
--  Reproduit resolve_market (L527-621).
--
--  Étapes :
--    1. annule tous les ordres ouverts (remboursements) ;
--    2. PRE-CHECK invariant (faille B2) : refuser si carnet incohérent ;
--    3. paie SHARE_VALUE par part gagnante (puise dans l'escrow) ;
--    4. détruit les parts perdantes ;
--    5. assert final : escrow == 0 (sinon FROZEN).
-- ===========================================================================
create or replace function public.resolve_market(
  p_market_id  bigint,
  p_outcome    public.market_outcome,
  p_admin_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market  record;
  v_pool    record;
  v_sv      numeric;
  v_yes_total bigint;
  v_no_total  bigint;
  v_pairs     bigint;
  v_pos       record;
  v_payout    numeric;
  v_wallet_id bigint;
begin
  v_sv := current_setting('app.share_value', true)::numeric;
  if v_sv is null then v_sv := 5000; end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if v_market.status not in ('LOCKED', 'RESOLVING', 'OPEN', 'FROZEN') then
    perform public.market_error('Marché non résolvable.');
  end if;

  select * into v_pool from public.market_pools where market_id = p_market_id for update;

  -- 1) Figé le marché + annulation du carnet.
  update public.markets
    set status = 'RESOLVED', outcome = p_outcome,
        resolved_by = p_admin_id, resolved_at = now()
  where id = p_market_id;

  perform public.release_order_resources(o.id, p_admin_id)
  from public.orders o
  where o.market_id = p_market_id and o.status in ('OPEN', 'PARTIAL');

  -- 2) PRE-CHECK invariant (faille B2) : ne payer PERSONNE si incohérent.
  select coalesce(sum(quantity), 0) into v_yes_total
    from public.positions where market_id = p_market_id and outcome = 'YES';
  select coalesce(sum(quantity), 0) into v_no_total
    from public.positions where market_id = p_market_id and outcome = 'NO';
  v_pairs := v_pool.pairs_created - v_pool.pairs_destroyed;

  if (v_pool.escrow_balance <> v_pairs * v_sv)
     or (v_yes_total <> v_no_total)
     or (v_yes_total <> v_pairs) then
    perform public.market_error(
      'Résolution impossible : carnet incohérent (YES=' || v_yes_total
      || ', NO=' || v_no_total || ', paires=' || v_pairs
      || ', escrow=' || v_pool.escrow_balance || '). Aucun paiement effectué.'
    );
  end if;

  -- 3 & 4) Paiement des gagnants + destruction de toutes les positions.
  for v_pos in select * from public.positions where market_id = p_market_id for update loop
    if v_pos.outcome = p_outcome and v_pos.quantity > 0 then
      v_payout := v_sv * v_pos.quantity;
      if v_pool.escrow_balance < v_payout then
        perform public.market_error('Escrow insuffisant lors de la résolution.');
      end if;
      select id into v_wallet_id from public.wallets where user_id = v_pos.user_id;
      perform public.post_entry(
        p_wallet_id := v_wallet_id,
        p_entry_type := 'SETTLE_WIN',
        p_amount := v_payout,
        p_related_type := 'market', p_related_id := p_market_id,
        p_reference := '#WIN-M' || p_market_id,
        p_note := 'Résolution marché — ' || p_outcome || ' gagnant',
        p_created_by := p_admin_id
      );
      v_pool.escrow_balance := v_pool.escrow_balance - v_payout;
      update public.market_pools set escrow_balance = v_pool.escrow_balance
        where market_id = p_market_id;
    end if;
    delete from public.positions where id = v_pos.id;
  end loop;

  -- 5) Assert final : escrow doit retomber à 0.
  select escrow_balance into v_pool from public.market_pools where market_id = p_market_id;
  if v_pool.escrow_balance <> 0 then
    update public.markets set status = 'FROZEN' where id = p_market_id;
    perform public.market_error('Résolution incohérente : escrow résiduel ' || v_pool.escrow_balance);
  end if;
end;
$$;


-- ===========================================================================
--  cancel_market — annulation (remboursement universel SHARE_VALUE/2 par part).
--  Reproduit cancel_market (L624-705).
-- ===========================================================================
create or replace function public.cancel_market(
  p_market_id bigint,
  p_admin_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market  record;
  v_pool    record;
  v_sv      numeric;
  v_yes_total bigint;
  v_no_total  bigint;
  v_pairs     bigint;
  v_refund_per_share numeric;
  v_pos       record;
  v_payout    numeric;
  v_wallet_id bigint;
begin
  v_sv := current_setting('app.share_value', true)::numeric;
  if v_sv is null then v_sv := 5000; end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if v_market.status = 'CANCELLED' then return; end if;

  select * into v_pool from public.market_pools where market_id = p_market_id for update;

  update public.markets
    set status = 'CANCELLED', resolved_by = p_admin_id, resolved_at = now()
  where id = p_market_id;

  -- Annule le carnet.
  perform public.release_order_resources(o.id, p_admin_id)
  from public.orders o
  where o.market_id = p_market_id and o.status in ('OPEN', 'PARTIAL');

  -- PRE-CHECK invariant.
  select coalesce(sum(quantity), 0) into v_yes_total
    from public.positions where market_id = p_market_id and outcome = 'YES';
  select coalesce(sum(quantity), 0) into v_no_total
    from public.positions where market_id = p_market_id and outcome = 'NO';
  v_pairs := v_pool.pairs_created - v_pool.pairs_destroyed;

  if (v_pool.escrow_balance <> v_pairs * v_sv)
     or (v_yes_total <> v_no_total)
     or (v_yes_total <> v_pairs) then
    perform public.market_error('Annulation impossible : carnet incohérent.');
  end if;

  v_refund_per_share := round(v_sv / 2, 2);

  for v_pos in select * from public.positions where market_id = p_market_id for update loop
    if v_pos.quantity > 0 then
      v_payout := round(v_refund_per_share * v_pos.quantity, 2);
      if v_pool.escrow_balance < v_payout then
        perform public.market_error('Escrow insuffisant lors de l''annulation.');
      end if;
      select id into v_wallet_id from public.wallets where user_id = v_pos.user_id;
      perform public.post_entry(
        p_wallet_id := v_wallet_id,
        p_entry_type := 'SETTLE_WIN',
        p_amount := v_payout,
        p_related_type := 'market', p_related_id := p_market_id,
        p_reference := '#RFD-M' || p_market_id,
        p_note := 'Annulation marché — remboursement ' || v_refund_per_share || '/part',
        p_created_by := p_admin_id
      );
      v_pool.escrow_balance := v_pool.escrow_balance - v_payout;
      update public.market_pools set escrow_balance = v_pool.escrow_balance
        where market_id = p_market_id;
    end if;
    delete from public.positions where id = v_pos.id;
  end loop;

  -- Assert final.
  select escrow_balance into v_pool from public.market_pools where market_id = p_market_id;
  if v_pool.escrow_balance <> 0 then
    update public.markets set status = 'FROZEN' where id = p_market_id;
    perform public.market_error('Annulation incohérente : escrow résiduel ' || v_pool.escrow_balance);
  end if;
end;
$$;


-- ===========================================================================
--  Cron : auto_lock, expire_orders, freeze, verify_invariants
-- ===========================================================================

-- auto_lock_expired_markets — OPEN → LOCKED si clôture dépassée.
-- Reproduit auto_lock_expired_markets (L712-726).
create or replace function public.auto_lock_expired_markets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with updated as (
    update public.markets set status = 'LOCKED'
    where status = 'OPEN' and bet_close_at <= now()
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;


-- expire_orders — marque EXPIRÉS les ordres ouverts dont expires_at est dépassé.
-- Reproduit expire_orders (L503-520). Idempotent.
create or replace function public.expire_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer := 0;
  v_order record;
begin
  for v_order in
    select id, user_id from public.orders
    where status in ('OPEN', 'PARTIAL') and expires_at <= now()
    for update
  loop
    perform public.release_order_resources(v_order.id, v_order.user_id);
    update public.orders set status = 'EXPIRED' where id = v_order.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


-- freeze_market — gèle un marché (anomalie d'invariance).
create or replace function public.freeze_market(p_market_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.markets set status = 'FROZEN' where id = p_market_id;
end;
$$;


-- ===========================================================================
--  verify_invariants — vérifie les invariants financiers + gèle les anomalies.
--  Reproduit verify_invariants (L742-822).
--
--  Invariants :
--    a) par marché : escrow == pairs × SHARE_VALUE ET ΣYES == ΣNO == pairs ;
--    b) global     : Σbalances + Σescrow == Σdépôts approuvés − Σretraits payés.
-- ===========================================================================
create or replace function public.verify_invariants()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report jsonb;
  v_frozen jsonb[] := array[]::jsonb[];
  v_sv numeric;
  v_market record;
  v_pool record;
  v_yes_total bigint;
  v_no_total bigint;
  v_pairs bigint;
  v_total_balance numeric;
  v_total_escrow numeric;
  v_deposits_in numeric;
  v_withdrawals_out numeric;
  v_actual numeric;
  v_expected numeric;
  v_global_ok boolean := true;
  v_global jsonb;
begin
  v_sv := current_setting('app.share_value', true)::numeric;
  if v_sv is null then v_sv := 5000; end if;

  -- a) Invariants par marché.
  for v_market in
    select * from public.markets where status <> 'RESOLVED'
  loop
    select * into v_pool from public.market_pools where market_id = v_market.id;
    if not found then
      v_frozen := array_append(v_frozen, jsonb_build_object('market', v_market.id, 'reason', 'pool manquant'));
      perform public.freeze_market(v_market.id);
      continue;
    end if;

    select coalesce(sum(quantity), 0) into v_yes_total
      from public.positions where market_id = v_market.id and outcome = 'YES';
    select coalesce(sum(quantity), 0) into v_no_total
      from public.positions where market_id = v_market.id and outcome = 'NO';
    v_pairs := v_pool.pairs_created - v_pool.pairs_destroyed;

    if not (
      v_pool.escrow_balance = v_pairs * v_sv
      and v_yes_total = v_no_total
      and v_yes_total = v_pairs
    ) then
      v_frozen := array_append(v_frozen, jsonb_build_object(
        'market', v_market.id,
        'escrow', v_pool.escrow_balance,
        'yes_total', v_yes_total,
        'no_total', v_no_total,
        'pairs', v_pairs
      ));
      perform public.freeze_market(v_market.id);
    end if;
  end loop;

  -- b) Invariant global (conservation de la masse monétaire).
  select coalesce(sum(balance), 0) into v_total_balance from public.wallets;
  select coalesce(sum(escrow_balance), 0) into v_total_escrow from public.market_pools;
  select coalesce(sum(amount), 0) into v_deposits_in
    from public.deposit_requests where status = 'APPROVED';
  select coalesce(sum(amount), 0) into v_withdrawals_out
    from public.withdraw_requests where status = 'PAID';

  v_actual := v_total_balance + v_total_escrow;
  v_expected := v_deposits_in - v_withdrawals_out;

  if v_actual <> v_expected then
    v_global_ok := false;
    v_global := jsonb_build_object(
      'actual', v_actual, 'expected', v_expected,
      'balance', v_total_balance, 'escrow', v_total_escrow,
      'deposits_in', v_deposits_in, 'withdrawals_out', v_withdrawals_out
    );
  end if;

  return jsonb_build_object(
    'frozen_markets', to_jsonb(v_frozen),
    'global_invariant_ok', v_global_ok,
    'global', coalesce(v_global, 'null'::jsonb)
  );
end;
$$;
