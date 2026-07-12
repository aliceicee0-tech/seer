-- ===========================================================================
--  FIX delete_market : ne supprimait pas les paris (table bets)
--
--  La fonction 0014 était pré-pari-mutuel : elle supprimait orders, trades,
--  positions, market_pools mais PAS bets. Or la FK bets.market_id → markets(id)
--  ON DELETE RESTRICT bloquait toute suppression → erreur 400.
--
--  Maintenant : on supprime aussi bets, MAIS on bloque la suppression s'il y a
--  encore des paris PENDING (argent non distribué → protéger les joueurs).
--  Un marché RESOLVED (bets WON/LOST) ou CANCELLED (bets REFUNDED) est
--  supprimable : l'argent est déjà réglé, on nettoie juste l'historique.
-- ===========================================================================

create or replace function public.delete_market(
  p_market_id bigint,
  p_admin_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market        record;
  v_pending_bets  integer;
begin
  if not public.caller_is_service_role() and not public.is_platform_admin() then
    perform public.market_error('Suppression réservée aux administrateurs.');
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then
    perform public.market_error('Marché introuvable.');
  end if;

  -- Compte les paris encore en attente (argent non distribué).
  select count(*) into v_pending_bets
    from public.bets where market_id = p_market_id and status = 'PENDING';

  if v_pending_bets > 0 then
    perform public.market_error(
      'Suppression impossible : ' || v_pending_bets
      || ' pari(s) encore en attente. Résolvez ou annulez le marché d''abord.'
    );
  end if;

  -- À ce stade : soit pas de paris, soit tous réglés (WON/LOST/REFUNDED).
  -- Suppression en cascade dans l'ordre des dépendances.
  delete from public.bets         where market_id = p_market_id;
  delete from public.orders       where market_id = p_market_id;
  delete from public.trades       where market_id = p_market_id;
  delete from public.positions    where market_id = p_market_id;
  delete from public.market_pools where market_id = p_market_id;
  delete from public.markets      where id = p_market_id;
end;
$$;
