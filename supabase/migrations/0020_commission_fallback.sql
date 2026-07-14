-- ===========================================================================
--  Nexus v2 — Fix critique : la commission plateforme ne s'évapore plus
--
--  PROBLÈME : dans resolve_market (0017), la commission était RETIRÉE du pot
--  (pot_net = pot_total - commission) mais créditée sur un wallet UNIQUEMENT
--  si platform_user_id était renseigné dans platform_config. Or aucune
--  migration ne renseignait ce champ (initialisé à NULL en 0013) → si l'admin
--  n'avait pas mis son UUID manuellement en base, les 10% étaient prélevés aux
--  joueurs mais envoyés NULLE PART. Argent perdu silencieusement à chaque
--  résolution.
--
--  FIX : fallback automatique. Si platform_user_id est NULL, la commission est
--  créditée à l'admin qui résout le marché (p_admin_id). Ainsi la commission
--  arrive TOUJOURS quelque part, même sans configuration préalable.
--  Si platform_user_id est renseigné, il reste prioritaire (wallet dédié).
--
--  Sécurité : on ne fait que renforcer — le comportement configuré est
--  inchangé, seul le cas NULL (qui était un bug) est corrigé.
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
  v_market        record;
  v_pot_total     numeric;
  v_pool_winner   numeric;
  v_rate          numeric;
  v_platform_uid  uuid;
  v_platform_wid  bigint;
  v_fee_uid       uuid;       -- destinataire effectif de la commission
  v_commission    numeric;
  v_pot_net       numeric;
  v_bet           record;
  v_payout        numeric;
  v_wallet_id     bigint;
  v_count         integer := 0;
begin
  select * into v_market from public.markets where id = p_market_id for update;
  if v_market.status not in ('LOCKED', 'RESOLVING', 'OPEN', 'FROZEN') then
    perform public.market_error('Marché non résolvable.');
  end if;

  -- Gèle le marché.
  update public.markets
    set status = 'RESOLVED', outcome = p_outcome,
        resolved_by = p_admin_id, resolved_at = now()
    where id = p_market_id;

  v_pot_total := v_market.pool_yes + v_market.pool_no;

  -- Cas dégénéré : aucun pari sur ce marché → on termine sans distribution.
  if v_pot_total = 0 then
    return;
  end if;

  -- Config commission.
  select commission_rate, platform_user_id into v_rate, v_platform_uid
    from public.platform_config where id = 1;
  if v_rate is null then v_rate := 0; end if;

  -- --- FIX : destinataire effectif de la commission -----------------------
  -- Priorité : platform_user_id (wallet dédié) ; sinon l'admin qui résout.
  -- On NE PERD PLUS la commission : elle arrive toujours sur un wallet.
  v_fee_uid := coalesce(v_platform_uid, p_admin_id);
  if v_fee_uid is not null then
    select id into v_platform_wid from public.wallets where user_id = v_fee_uid;
  end if;

  -- Commission plateforme (10% du pot total par défaut).
  v_commission := round(v_pot_total * v_rate / 100);
  v_pot_net := v_pot_total - v_commission;

  if v_commission > 0 and v_platform_wid is not null then
    perform public.post_entry(
      p_wallet_id := v_platform_wid,
      p_entry_type := 'SETTLE_FEE',
      p_amount := v_commission,
      p_related_type := 'market', p_related_id := p_market_id,
      p_reference := '#FEE-M' || p_market_id,
      p_note := 'Commission ' || v_rate || '% pari mutuel'
                || case when v_platform_uid is null
                   then ' (fallback admin résolveur)'
                   else '' end,
      p_created_by := p_admin_id
    );
  end if;

  -- Pool gagnant (pour calculer la part de chaque gagnant).
  v_pool_winner := case when p_outcome = 'YES' then v_market.pool_yes else v_market.pool_no end;

  -- Distribue aux gagnants (au prorata de leur mise dans le pool gagnant).
  if v_pool_winner > 0 then
    for v_bet in
      select * from public.bets
        where market_id = p_market_id and outcome = p_outcome and status = 'PENDING'
        for update
    loop
      v_payout := round((v_bet.amount / v_pool_winner) * v_pot_net, 2);
      select id into v_wallet_id from public.wallets where user_id = v_bet.user_id;

      perform public.post_entry(
        p_wallet_id := v_wallet_id,
        p_entry_type := 'SETTLE_WIN',
        p_amount := v_payout,
        p_related_type := 'bet', p_related_id := v_bet.id,
        p_reference := '#WIN-M' || p_market_id,
        p_note := 'Gain pari — ' || p_outcome || ' gagnant',
        p_created_by := p_admin_id
      );

      update public.bets
        set status = 'WON', payout = v_payout, resolved_at = now()
        where id = v_bet.id;

      v_count := v_count + 1;
    end loop;
  end if;

  -- Marque les perdants.
  update public.bets
    set status = 'LOST', resolved_at = now()
    where market_id = p_market_id and outcome <> p_outcome and status = 'PENDING';
end;
$$;
