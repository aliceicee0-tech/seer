-- ===========================================================================
--  FIX : place_order échouait avec
--  "column 'status' is of type order_status but expression is of type text"
--
--  Cause : les CASE qui assignent le statut des ordres renvoyaient du text
--  brut ('FILLED', 'PARTIAL', 'OPEN') sans caster en public.order_status.
--  PostgreSQL refuse la conversion implicite text → enum.
--
--  Solution : recréer place_order avec les casts explicites ::order_status.
--  On reprend la fonction exacte de 0005 avec uniquement ce correctif.
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
  if p_quantity <= 0 then
    perform public.market_error('La quantité doit être positive.');
  end if;

  if p_order_type = 'LIMIT' then
    if p_price is null then
      perform public.market_error('Un ordre LIMIT requiert un prix.');
    end if;
    if p_price < v_min_price or p_price > v_max_price then
      perform public.market_error('Prix hors bornes [' || v_min_price || ', ' || v_max_price || '] Ar.');
    end if;
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if v_market.status <> 'OPEN' or now() >= v_market.bet_close_at then
    perform public.market_error('Ce carnet d''ordres est fermé.');
  end if;

  select id into v_wallet_id from public.wallets where user_id = p_user_id;

  -- Pré-réservation des ressources AVANT toute exécution.
  if p_side = 'BUY' then
    if p_order_type = 'LIMIT' then
      begin
        perform public.lock_amount(v_wallet_id, p_price * p_quantity);
      exception when check_violation then
        perform public.market_error('Solde disponible insuffisant.');
      end;
    end if;
  else  -- SELL
    v_pos_id := public.get_or_create_position_locked(p_user_id, p_market_id, p_outcome);
    select * into v_pos from public.positions where id = v_pos_id for update;
    if (v_pos.quantity - v_pos.locked_quantity) < p_quantity then
      perform public.market_error('Parts disponibles insuffisantes pour la vente.');
    end if;
    update public.positions set locked_quantity = locked_quantity + p_quantity
      where id = v_pos_id;
  end if;

  -- Crée l'ordre.
  insert into public.orders
    (user_id, market_id, side, order_type, outcome, price, quantity, expires_at)
  values
    (p_user_id, p_market_id, p_side, p_order_type, p_outcome,
     case when p_order_type = 'LIMIT' then p_price else null end,
     p_quantity, p_expires_at)
  returning id into v_order_id;

  -- ===== MATCHING =====
  v_opp_side := case when p_side = 'BUY' then 'SELL'::public.order_side else 'BUY'::public.order_side end;
  v_remaining := p_quantity;

  while v_remaining > 0 loop
    if p_side = 'BUY' then
      select * into v_resting from public.orders
        where market_id = p_market_id
          and outcome = p_outcome
          and side = v_opp_side
          and status in ('OPEN', 'PARTIAL')
          and price is not null
          and user_id <> p_user_id
        order by price asc, created_at asc, id asc
        limit 1
        for update skip locked;
    else
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

    exit when v_resting is null;

    if (v_resting.quantity - v_resting.filled_quantity) <= 0 then
      update public.orders set status = 'FILLED'::public.order_status where id = v_resting.id;
      continue;
    end if;

    if p_side = 'BUY' then
      if p_price is not null and p_price < v_resting.price then exit; end if;
    else
      if p_price is not null and p_price > v_resting.price then exit; end if;
    end if;

    v_fill_price := v_resting.price;
    v_fill_qty := least(v_remaining, v_resting.quantity - v_resting.filled_quantity);
    exit when v_fill_qty <= 0;

    if p_side = 'BUY' then
      v_buyer_id := p_user_id;          v_buy_order_id := v_order_id;
      v_seller_id := v_resting.user_id; v_sell_order_id := v_resting.id;
    else
      v_buyer_id := v_resting.user_id;  v_buy_order_id := v_resting.id;
      v_seller_id := p_user_id;         v_sell_order_id := v_order_id;
    end if;

    v_cost := v_fill_price * v_fill_qty;
    select id into v_buyer_wallet from public.wallets where user_id = v_buyer_id;
    select id into v_seller_wallet from public.wallets where user_id = v_seller_id;

    -- Côté ACHETEUR
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

    -- Côté VENDEUR
    perform public.post_entry(
      p_wallet_id := v_seller_wallet,
      p_entry_type := 'TRADE_SELL',
      p_amount := v_cost,
      p_related_type := 'order', p_related_id := v_sell_order_id,
      p_reference := '#SELL-M' || p_market_id,
      p_note := 'Vente ' || v_fill_qty || '× ' || p_outcome || ' @ ' || v_fill_price,
      p_created_by := v_seller_id
    );

    -- Transfert de parts vendeur → acheteur
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

    -- --- Avancement des ordres (FIX : cast ::order_status) ---
    update public.orders
      set filled_quantity = filled_quantity + v_fill_qty,
          status = case
            when filled_quantity + v_fill_qty >= quantity then 'FILLED'::public.order_status
            else 'PARTIAL'::public.order_status
          end
    where id in (v_buy_order_id, v_sell_order_id);

    insert into public.trades
      (market_id, outcome, buyer_id, seller_id, buy_order_id, sell_order_id, price, quantity)
    values
      (p_market_id, p_outcome, v_buyer_id, v_seller_id, v_buy_order_id, v_sell_order_id, v_fill_price, v_fill_qty);

    v_remaining := v_remaining - v_fill_qty;
  end loop;

  -- Statut final de l'ordre agresseur (FIX : cast ::order_status).
  update public.orders
    set status = case
      when filled_quantity >= quantity then 'FILLED'::public.order_status
      when filled_quantity > 0 then 'PARTIAL'::public.order_status
      else 'OPEN'::public.order_status
    end
  where id = v_order_id;

  return v_order_id;
end;
$$;
