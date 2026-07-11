-- ===========================================================================
--  Nexus v2 — Markets RPC (moteur Polymarket collatéralisé)
--
--  Traduction fidèle de markets/services.py en PL/pgSQL.
--  Modèle financier : COLLATÉRALISATION STRICTE. Invariant fondamental :
--
--    escrow(market) == YES_en_circulation × SHARE_VALUE
--                   == NO_en_circulation × SHARE_VALUE
--                   == (pairs_created − pairs_destroyed) × SHARE_VALUE
--
--  Opérations :
--    - mint_pair  : 1 × SHARE_VALUE wallet → escrow ; crée 1 YES + 1 NO.
--    - merge_pair : détruit 1 YES + 1 NO ; escrow → 1 × SHARE_VALUE wallet.
--    - place_order : crée un ordre et tente de l'exécuter contre le carnet.
--    - resolve_market : paie SHARE_VALUE/part gagnante, détruit les perdantes.
--    - cancel_market : rembourse SHARE_VALUE/2 par part (tous côtés).
-- ===========================================================================

-- Exception métier reproduisant MarketError.
create or replace function public.market_error(msg text)
returns void
language plpgsql
as $$
begin
  raise exception '%', msg using errcode = 'raise_exception';
end;
$$;


-- ===========================================================================
--  mint_pair — émet `count` paires (1 YES + 1 NO) pour un utilisateur.
--  Reproduit markets/services.py mint_pair (L120-165).
-- ===========================================================================
create or replace function public.mint_pair(
  p_user_id   uuid,
  p_market_id bigint,
  p_count     integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market  record;
  v_pool    record;
  v_wallet_id bigint;
  v_sv      numeric;
  v_cost    numeric;
  v_pos_id  bigint;
  v_old_qty bigint;
  v_old_avg numeric;
begin
  if p_count <= 0 then
    perform public.market_error('Le nombre de paires doit être positif.');
  end if;

  -- Vérifie que le marché est tradeable (statut OPEN + date non dépassée).
  select * into v_market from public.markets where id = p_market_id for update;
  if v_market.status <> 'OPEN' or now() >= v_market.bet_close_at then
    perform public.market_error('Ce marché n''accepte plus d''émissions.');
  end if;

  -- Verrouille le pool du marché.
  select * into v_pool from public.market_pools where market_id = p_market_id for update;
  if not found then
    perform public.market_error('Pool de marché introuvable.');
  end if;

  select id into v_wallet_id from public.wallets where user_id = p_user_id;
  v_sv   := current_setting('app.share_value', true)::numeric;
  if v_sv is null then v_sv := 5000; end if;
  v_cost := v_sv * p_count;

  -- 1) Débit wallet → séquestre marché (écriture MINT).
  begin
    perform public.post_entry(
      p_wallet_id := v_wallet_id,
      p_entry_type := 'MINT',
      p_amount := -v_cost,
      p_related_type := 'market_pool',
      p_related_id := p_market_id,
      p_reference := '#MINT-M' || p_market_id,
      p_note := 'Émission de ' || p_count || ' paire(s) YES+NO',
      p_created_by := p_user_id
    );
  exception when check_violation then
    perform public.market_error('Solde insuffisant pour l''émission.');
  end;

  -- 2) Escrow += cost × count, compteur de paires.
  update public.market_pools
    set escrow_balance = escrow_balance + v_cost,
        pairs_created  = pairs_created + p_count
  where market_id = p_market_id;

  -- 3) Crédit des parts YES et NO (moyen = share_value à l'émission).
  for v_pos_id in
    select public.get_or_create_position_locked(p_user_id, p_market_id, o.out)
    from (values ('YES'), ('NO')) as o(out)
  loop
    select quantity, avg_buy_price into v_old_qty, v_old_avg
    from public.positions where id = v_pos_id for update;

    update public.positions
      set avg_buy_price = public.new_avg_buy_price(v_old_qty, v_old_avg, p_count, v_sv),
          quantity = quantity + p_count
    where id = v_pos_id;
  end loop;
end;
$$;


-- ===========================================================================
--  merge_pair — fusionne `count` paires YES+NO, libère SHARE_VALUE/paire.
--  Reproduit markets/services.py merge_pair (L168-214).
-- ===========================================================================
create or replace function public.merge_pair(
  p_user_id   uuid,
  p_market_id bigint,
  p_count     integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
  v_pool   record;
  v_wallet_id bigint;
  v_sv     numeric;
  v_release numeric;
  v_pos_yes record;
  v_pos_no  record;
begin
  if p_count <= 0 then
    perform public.market_error('Le nombre de paires doit être positif.');
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if v_market.status <> 'OPEN' or now() >= v_market.bet_close_at then
    perform public.market_error('Ce marché n''accepte plus de fusions.');
  end if;

  select * into v_pool from public.market_pools where market_id = p_market_id for update;
  if not found then perform public.market_error('Pool introuvable.'); end if;

  select id into v_wallet_id from public.wallets where user_id = p_user_id;

  -- Vérifie la détention disponible des deux côtés.
  select * into v_pos_yes from public.positions
    where user_id = p_user_id and market_id = p_market_id and outcome = 'YES' for update;
  select * into v_pos_no from public.positions
    where user_id = p_user_id and market_id = p_market_id and outcome = 'NO' for update;

  if (v_pos_yes is null) or (v_pos_no is null)
     or (coalesce(v_pos_yes.quantity - v_pos_yes.locked_quantity, 0) < p_count)
     or (coalesce(v_pos_no.quantity - v_pos_no.locked_quantity, 0) < p_count) then
    perform public.market_error('Fusion impossible : pas assez de parts YES + NO disponibles.');
  end if;

  -- Détruit les parts.
  update public.positions set quantity = quantity - p_count
    where id = v_pos_yes.id;
  update public.positions set quantity = quantity - p_count
    where id = v_pos_no.id;

  -- Libère l'escrow.
  v_sv := current_setting('app.share_value', true)::numeric;
  if v_sv is null then v_sv := 5000; end if;
  v_release := v_sv * p_count;

  update public.market_pools
    set escrow_balance = escrow_balance - v_release,
        pairs_destroyed = pairs_destroyed + p_count
  where market_id = p_market_id;

  -- Crédit wallet ← escrow (écriture MERGE).
  perform public.post_entry(
    p_wallet_id := v_wallet_id,
    p_entry_type := 'MERGE',
    p_amount := v_release,
    p_related_type := 'market_pool',
    p_related_id := p_market_id,
    p_reference := '#MRGE-M' || p_market_id,
    p_note := 'Fusion de ' || p_count || ' paire(s) YES+NO',
    p_created_by := p_user_id
  );
end;
$$;


-- ===========================================================================
--  place_order — crée un ordre et l'exécute contre le carnet (CLOB).
--  Reproduit markets/services.py place_order + _match + _execute_fill (L221-440).
--
--  C'est la fonction la plus complexe du système. Le matching priorise
--  prix → date → FIFO, et le prix d'exécution = prix de l'ordre passif.
-- ===========================================================================
create or replace function public.place_order(
  p_user_id    uuid,
  p_market_id  bigint,
  p_side       public.order_side,
  p_outcome    public.market_outcome,
  p_order_type public.order_type,
  p_quantity   bigint,
  p_price      numeric default null,
  p_expires_at timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market     record;
  v_wallet_id  bigint;
  v_pos_id     bigint;
  v_pos        record;
  v_order_id   bigint;
  v_min_price  numeric := 1;
  v_max_price  numeric := 4999;
  -- Variables de matching
  v_opp_side   public.order_side;
  v_resting    record;
  v_remaining  bigint;
  v_fill_qty   bigint;
  v_fill_price numeric;
  v_buyer_id   uuid;
  v_seller_id  uuid;
  v_buy_order_id bigint;
  v_sell_order_id bigint;
  v_cost       numeric;
  v_reserve_release numeric;
  v_buyer_wallet bigint;
  v_seller_wallet bigint;
  v_bp_old_qty bigint;
  v_bp_old_avg numeric;
  v_sp_old_qty bigint;
  v_sp_old_lk  bigint;
begin
  v_quantity := p_quantity;
  if v_quantity <= 0 then
    perform public.market_error('La quantité doit être positive.');
  end if;

  -- Validation du prix (bornes en Ar) — défense en profondeur.
  if p_order_type = 'LIMIT' then
    if p_price is null then
      perform public.market_error('Un ordre LIMIT requiert un prix.');
    end if;
    if p_price < v_min_price or p_price > v_max_price then
      perform public.market_error('Prix hors bornes [' || v_min_price || ', ' || v_max_price || '] Ar.');
    end if;
  end if;

  -- Verrouille le marché pour éviter toute concurrence sur le carnet.
  select * into v_market from public.markets where id = p_market_id for update;
  if v_market.status <> 'OPEN' or now() >= v_market.bet_close_at then
    perform public.market_error('Ce carnet d''ordres est fermé.');
  end if;

  select id into v_wallet_id from public.wallets where user_id = p_user_id;

  -- Pré-réservation des ressources AVANT toute exécution.
  if p_side = 'BUY' then
    if p_order_type = 'LIMIT' then
      -- Séquestre qty × price (pire cas) dans locked_balance.
      begin
        perform public.lock_amount(v_wallet_id, p_price * v_quantity);
      exception when check_violation then
        perform public.market_error('Solde disponible insuffisant.');
      end;
    end if;
    -- Achat MARKET : pas de réservation (paiement au fil des fills).
  else  -- SELL
    v_pos_id := public.get_or_create_position_locked(p_user_id, p_market_id, p_outcome);
    select * into v_pos from public.positions where id = v_pos_id for update;
    if (v_pos.quantity - v_pos.locked_quantity) < v_quantity then
      perform public.market_error('Parts disponibles insuffisantes pour la vente.');
    end if;
    update public.positions set locked_quantity = locked_quantity + v_quantity
      where id = v_pos_id;
  end if;

  -- Crée l'ordre.
  insert into public.orders
    (user_id, market_id, side, order_type, outcome, price, quantity, expires_at)
  values
    (p_user_id, p_market_id, p_side, p_order_type, p_outcome,
     case when p_order_type = 'LIMIT' then p_price else null end,
     v_quantity, p_expires_at)
  returning id into v_order_id;

  -- ===== MATCHING =====
  v_opp_side := case when p_side = 'BUY' then 'SELL'::public.order_side else 'BUY'::public.order_side end;
  v_remaining := v_quantity;

  while v_remaining > 0 loop
    -- Sélection du meilleur ordre opposé selon priorité prix → date → FIFO.
    if p_side = 'BUY' then
      -- Acheteur : cherche les VENTES les moins chères d'abord.
      select * into v_resting from public.orders
        where market_id = p_market_id
          and outcome = p_outcome
          and side = v_opp_side
          and status in ('OPEN', 'PARTIAL')
          and price is not null
          and user_id <> p_user_id  -- pas de self-trade
        order by price asc, created_at asc, id asc
        limit 1
        for update skip locked;
    else
      -- Vendeur : cherche les ACHATS les plus chers d'abord.
      select * into v_resting from public.orders
        where market_id = p_market_id
          and outcome = p_outcome
          and side = v_opp_side
          and status in ('OPEN', 'PARTIAL')
          and price is not null
          and user_id <> p_user_id
        order by price desc, created_at asc, id asc
        limit 1
        for update skip locked;
    end if;

    exit when v_resting is null;  -- carnet vide

    if (v_resting.quantity - v_resting.filled_quantity) <= 0 then
      -- Ordre saturé non reclassé : on le clôture (défense en profondeur).
      update public.orders set status = 'FILLED' where id = v_resting.id;
      continue;
    end if;

    -- Vérification de compatibilité (prix).
    if p_side = 'BUY' then
      if p_price is not null and p_price < v_resting.price then
        exit;  -- prix limite non atteint
      end if;
    else  -- SELL
      if p_price is not null and p_price > v_resting.price then
        exit;
      end if;
    end if;

    -- Prix d'exécution = prix de l'ordre passif (au repos).
    v_fill_price := v_resting.price;
    v_fill_qty := least(v_remaining, v_resting.quantity - v_resting.filled_quantity);

    exit when v_fill_qty <= 0;

    -- ===== _execute_fill =====
    -- Détermine acheteur / vendeur selon le côté, indépendamment de l'agresseur.
    if p_side = 'BUY' then
      v_buyer_id := p_user_id;       v_buy_order_id := v_order_id;
      v_seller_id := v_resting.user_id; v_sell_order_id := v_resting.id;
    else
      v_buyer_id := v_resting.user_id;  v_buy_order_id := v_resting.id;
      v_seller_id := p_user_id;         v_sell_order_id := v_order_id;
    end if;

    v_cost := v_fill_price * v_fill_qty;
    select id into v_buyer_wallet from public.wallets where user_id = v_buyer_id;
    select id into v_seller_wallet from public.wallets where user_id = v_seller_id;

    -- --- Côté ACHETEUR ---
    if (select order_type from public.orders where id = v_buy_order_id) = 'LIMIT' then
      v_reserve_release := (select price from public.orders where id = v_buy_order_id) * v_fill_qty;
      perform public.settle_buy_fill(
        p_wallet_id := v_buyer_wallet,
        p_cost := v_cost,
        p_reserve_release := v_reserve_release,
        p_entry_type := 'TRADE_BUY',
        p_reference := '#BUY-M' || p_market_id,
        p_note := 'Achat ' || v_fill_qty || '× ' || p_outcome || ' @ ' || v_fill_price,
        p_related_id := v_buy_order_id,
        p_created_by := v_buyer_id
      );
    else
      -- Achat MARKET : débit direct.
      begin
        perform public.post_entry(
          p_wallet_id := v_buyer_wallet,
          p_entry_type := 'TRADE_BUY',
          p_amount := -v_cost,
          p_related_type := 'order', p_related_id := v_buy_order_id,
          p_reference := '#BUY-M' || p_market_id,
          p_note := 'Achat ' || v_fill_qty || '× ' || p_outcome || ' @ ' || v_fill_price || ' (market)',
          p_created_by := v_buyer_id
        );
      exception when check_violation then
        perform public.market_error('Solde insuffisant pour compléter l''ordre au marché.');
      end;
    end if;

    -- --- Côté VENDEUR ---
    perform public.post_entry(
      p_wallet_id := v_seller_wallet,
      p_entry_type := 'TRADE_SELL',
      p_amount := v_cost,
      p_related_type := 'order', p_related_id := v_sell_order_id,
      p_reference := '#SELL-M' || p_market_id,
      p_note := 'Vente ' || v_fill_qty || '× ' || p_outcome || ' @ ' || v_fill_price,
      p_created_by := v_seller_id
    );

    -- --- Transfert de parts vendeur → acheteur ---
    v_pos_id := public.get_or_create_position_locked(v_seller_id, p_market_id, p_outcome);
    select quantity, locked_quantity into v_sp_old_qty, v_sp_old_lk
      from public.positions where id = v_pos_id for update;
    update public.positions
      set quantity = quantity - v_fill_qty,
          locked_quantity = greatest(0, v_sp_old_lk - v_fill_qty)
    where id = v_pos_id;

    v_pos_id := public.get_or_create_position_locked(v_buyer_id, p_market_id, p_outcome);
    select quantity, avg_buy_price into v_bp_old_qty, v_bp_old_avg
      from public.positions where id = v_pos_id for update;
    update public.positions
      set avg_buy_price = public.new_avg_buy_price(v_bp_old_qty, v_bp_old_avg, v_fill_qty, v_fill_price),
          quantity = quantity + v_fill_qty
    where id = v_pos_id;

    -- --- Avancement des ordres ---
    update public.orders
      set filled_quantity = filled_quantity + v_fill_qty,
          status = case
            when filled_quantity + v_fill_qty >= quantity then 'FILLED'
            else 'PARTIAL'
          end
    where id in (v_buy_order_id, v_sell_order_id);

    -- --- Trade ---
    insert into public.trades
      (market_id, outcome, buyer_id, seller_id, buy_order_id, sell_order_id, price, quantity)
    values
      (p_market_id, p_outcome, v_buyer_id, v_seller_id, v_buy_order_id, v_sell_order_id, v_fill_price, v_fill_qty);

    v_remaining := v_remaining - v_fill_qty;
  end loop;

  -- Recalcule le statut final de l'ordre agresseur.
  update public.orders
    set status = case
      when filled_quantity >= quantity then 'FILLED'
      when filled_quantity > 0 then 'PARTIAL'
      else 'OPEN'
    end
  where id = v_order_id;

  return v_order_id;
end;
$$;
