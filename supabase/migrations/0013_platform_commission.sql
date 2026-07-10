-- ===========================================================================
--  Nexus v2 — Commission plateforme sur les gains à la résolution
--
--  Modèle : à chaque résolution de marché, X% du payout brut des gagnants est
--  prélevé et crédité sur le wallet d'un admin dédié (la plateforme).
--  Le reste (net) va au joueur gagnant. L'escrow est débité du payout brut,
--  donc l'invariant « escrow retombe à 0 » est préservé.
--
--  Exemple (taux 10%, SHARE_VALUE 5000, 10 parts gagnantes) :
--    payout brut = 50 000 Ar
--    commission  = 5 000 Ar  → wallet plateforme (écriture SETTLE_FEE)
--    net joueur  = 45 000 Ar → wallet joueur   (écriture SETTLE_WIN)
--    escrow débité = 50 000 Ar (5 000 + 45 000)
--
--  Paramétrage (settings DB, comme app.share_value) :
--    app.commission_rate     — taux en % (défaut 10)
--    app.platform_user_id    — UUID du user admin qui reçoit les commissions
--
--  Si app.platform_user_id est NULL/non configuré → aucune commission
--  prélevée (rétro-compatible, la plateforme ne prend rien).
-- ===========================================================================

-- --- Settings globaux (modifiables via ALTER DATABASE à chaud) --------------
alter database postgres set app.commission_rate = '10';
-- app.platform_user_id doit être défini manuellement (voir DEPLOY.md) :
--   alter database postgres set app.platform_user_id = '<uuid_admin>';


-- ===========================================================================
--  resolve_market v2 — distribue les gains NETS + commission plateforme.
--  Reprend la logique exacte de 0005b (L94-182) en ajoutant le prélèvement.
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
  v_market         record;
  v_pool           record;
  v_sv             numeric;
  v_yes_total      bigint;
  v_no_total       bigint;
  v_pairs          bigint;
  v_pos            record;
  v_payout         numeric;   -- gain brut (qty × SHARE_VALUE)
  v_commission     numeric;   -- part plateforme
  v_net            numeric;   -- gain net joueur
  v_wallet_id      bigint;
  v_platform_id    text;      -- UUID admin (setting)
  v_platform_wid   bigint;    -- wallet id plateforme
  v_rate           numeric;   -- taux commission en %
  v_total_commission numeric := 0;  -- cumul pour le log final
begin
  v_sv := current_setting('app.share_value', true)::numeric;
  if v_sv is null then v_sv := 5000; end if;

  -- Lecture du taux de commission (défaut 0 si non configuré).
  v_rate := coalesce(nullif(current_setting('app.commission_rate', true), '')::numeric, 0);
  -- Lecture de l'UUID admin plateforme (NULL si non configuré).
  v_platform_id := nullif(current_setting('app.platform_user_id', true), '');
  if v_platform_id is not null then
    select id into v_platform_wid from public.wallets where user_id = v_platform_id::uuid;
  end if;

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

      -- --- Commission plateforme (si configurée) -------------------------
      v_commission := 0;
      v_net := v_payout;
      if v_rate > 0 and v_platform_wid is not null then
        v_commission := round(v_payout * v_rate / 100);
        v_net := v_payout - v_commission;
        v_total_commission := v_total_commission + v_commission;

        -- Écriture commission → wallet plateforme (traçabilité comptable).
        perform public.post_entry(
          p_wallet_id := v_platform_wid,
          p_entry_type := 'SETTLE_FEE',
          p_amount := v_commission,
          p_related_type := 'market', p_related_id := p_market_id,
          p_reference := '#FEE-M' || p_market_id,
          p_note := 'Commission ' || v_rate || '% sur résolution marché',
          p_created_by := p_admin_id
        );
      end if;

      -- --- Gain net → wallet joueur ---------------------------------------
      select id into v_wallet_id from public.wallets where user_id = v_pos.user_id;
      perform public.post_entry(
        p_wallet_id := v_wallet_id,
        p_entry_type := 'SETTLE_WIN',
        p_amount := v_net,
        p_related_type := 'market', p_related_id := p_market_id,
        p_reference := '#WIN-M' || p_market_id,
        p_note := 'Résolution marché — ' || p_outcome || ' gagnant'
                  || case when v_commission > 0 then ' (net commission ' || v_rate || '%)' else '' end,
        p_created_by := p_admin_id
      );

      -- L'escrow est débité du PAYOUT BRUT (net + commission).
      v_pool.escrow_balance := v_pool.escrow_balance - v_payout;
      update public.market_pools set escrow_balance = v_pool.escrow_balance
        where market_id = p_market_id;
    end if;
    delete from public.positions where id = v_pos.id;
  end loop;

  -- 5) Assert final : escrow doit retomber à 0.
  --    net_joueur + commission = payout_brut → escrow vidé. Invariant préservé.
  select escrow_balance into v_pool from public.market_pools where market_id = p_market_id;
  if v_pool.escrow_balance <> 0 then
    update public.markets set status = 'FROZEN' where id = p_market_id;
    perform public.market_error('Résolution incohérente : escrow résiduel ' || v_pool.escrow_balance);
  end if;
end;
$$;
